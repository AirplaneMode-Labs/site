#!/usr/bin/env node
// Zero-dependency static site build for Airplane Mode Labs.
//   node scripts/build.mjs            -> dist/
// Exports build({root, outDir}) for the tests. Refuses to emit any page that contains a
// script tag, a stylesheet or script from a non-allowed host, or an inline style attribute.
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ALLOWED_RESOURCE_HOSTS = ['github.com', 'arxiv.org', 'doi.org'];

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function readMeta(fragment, key, fallback = '') {
  const m = new RegExp(`<!--\\s*${key}:\\s*([^\\n]*?)\\s*-->`).exec(fragment);
  return m ? m[1] : fallback;
}

function stripMeta(fragment) {
  return fragment.replace(/^(?:\s*<!--\s*[a-z-]+:[^\n]*-->\s*\n?)+/, '');
}

/** Throws when html breaks a rule. Anchors to other hosts are fine; resource loads are not. */
export function checkOutput(html, name) {
  if (/<script/i.test(html)) throw new Error(`refusing to build: ${name} contains <script`);
  if (/\sstyle="/i.test(html)) throw new Error(`refusing to build: ${name} has an inline style attribute`);
  const refs = [
    ...html.matchAll(/<(?:link|script)\b[^>]*?(?:href|src)="(https?:\/\/[^"/]+)/gi),
    ...html.matchAll(/@import\s+(?:url\()?["']?(https?:\/\/[^"'/)]+)/gi),
  ];
  for (const [, origin] of refs) {
    const host = new URL(origin).hostname;
    if (!ALLOWED_RESOURCE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
      throw new Error(`refusing to build: ${name} loads a resource from ${host}`);
    }
  }
}

const runGit = (root, args) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/**
 * The build id shown in every footer, the same convention as dockit and runtime's demo/build-id.ts buildLabel() (BUG-T1-S5-04, BUG-T1-S5-R2-04):
 *   in CI on main (GITHUB_SHA is exactly 40 lowercase hex, and GITHUB_REF is refs/heads/main or unset)   'Built from main at <sha12>'
 *   (a run on any other ref, such as a workflow_dispatch of pages.yml on a branch, is not 'main': it takes the git HEAD form below)
 *   locally, from git HEAD of this folder            'Local build <sha12>' or 'Local build <sha12>-dirty' (a tracked file differs from HEAD)
 *   anything else                                    'Local build unknown'
 * The last line is the documented fallback for a lone checkout with no .git (and for no git at all). git is trusted only when the
 * repository's top level is this very folder: a copy of the site inside another repository must not borrow that repository's HEAD.
 * `env` (default process.env) and `git` are injectable for the tests. The CI branch reads GITHUB_SHA and GITHUB_REF from `env` only, so a
 * test passes `env: {}` for "not in CI". (Individual `sha`/`ref` parameters with process.env defaults were removed: a default applies to an
 * explicit `undefined`, so `sha: undefined` silently read the runner's GITHUB_SHA and the local-build tests failed on GitHub Actions only.)
 */
export function buildId({ env = process.env, root, git = runGit } = {}) {
  const sha = env.GITHUB_SHA;
  const ref = env.GITHUB_REF;
  const onMain = ref === undefined || ref === '' || ref === 'refs/heads/main';
  if (typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha) && onMain) return `Built from main at ${sha.slice(0, 12)}`;
  try {
    const here = root ?? join(dirname(fileURLToPath(import.meta.url)), '..');
    const top = git(here, ['rev-parse', '--show-toplevel']);
    const real = (p) => {
      try {
        return realpathSync(p);
      } catch {
        return p;
      }
    };
    if (real(top) !== real(here)) return 'Local build unknown';
    const head = git(here, ['rev-parse', 'HEAD']);
    if (!/^[0-9a-f]{40}$/.test(head)) return 'Local build unknown';
    // untracked files do not count: dist/ and node_modules are ignored or new, and a new source file shows as modified once added
    const dirty = git(here, ['status', '--porcelain', '--untracked-files=no']).length > 0;
    return `Local build ${head.slice(0, 12)}${dirty ? '-dirty' : ''}`;
  } catch {
    return 'Local build unknown';
  }
}

const DRAFT_META = /<meta\s+name="draft"\s+content="true"\s*\/?>\s*\n?/i;
const NOINDEX = '\n    <meta name="robots" content="noindex" />';

/** A fragment is a draft when it carries <meta name="draft" content="true">. The marker is consumed. */
function takeDraft(fragment) {
  return { draft: DRAFT_META.test(fragment), fragment: fragment.replace(DRAFT_META, '') };
}

function renderLayout(layout, { title, description, content, root, active, built, draft }) {
  let html = layout
    .replaceAll('{{robots}}', draft ? NOINDEX : '')
    .replaceAll('{{title}}', esc(title))
    .replaceAll('{{description}}', esc(description))
    .replaceAll('{{root}}', root)
    .replaceAll('{{built}}', esc(built))
    .replace('{{content}}', () => content);
  html = html.replace(/\{\{active:([a-z]+)\}\}/g, (_, page) => (page === active ? 'aria-current="page"' : ''));
  return html;
}

function paperRow(p) {
  const title = p.url ? `<a href="${esc(p.url)}" rel="noopener noreferrer">${esc(p.title)}</a>` : esc(p.title);
  const cite = [p.authors.join(', '), p.year ?? '', p.venue ?? ''].filter(Boolean).map(esc).join(' · ');
  const repo = p.repo ? `<br /><span class="tag">${esc(p.repo)}</span>` : '';
  return `<tr class="paper" data-status="${esc(p.status)}" data-area="${esc(p.area)}">
  <td>${title}<br /><span class="muted">${cite}</span></td>
  <td><span class="tag">${esc(p.area)}</span>${repo}</td>
  <td class="paper-claim">${esc(p.claim)}</td>
  <td><span class="tag">${esc(p.status)}</span></td>
  <td>${esc(p.notes)}</td>
</tr>`;
}

function renderPapers(papers) {
  const byStatus = new Map();
  for (const p of papers) byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1);
  const summary = [...byStatus.entries()].map(([s, n]) => `${n} ${esc(s)}`).join(', ');
  return `<h1>Papers</h1>
<p class="lede">The reading list behind the tools: ${papers.length} papers, ${summary}. Status moves from
<em>to-read</em> through <em>reading</em>, <em>read</em>, <em>reproducing</em> to <em>reproduced</em> or
<em>not-reproduced</em>, and <em>write-up</em> once the note is published.</p>
<p class="muted">Citation rule: a title links to its source only after we fetched that source (arxiv.org, doi.org, a proceedings page
or the standard's own page) and logged the fetch. Entries marked "citation to verify" have not been checked yet
and carry no link.</p>
<div class="table-wrap">
<table class="papers">
<thead><tr><th>Paper</th><th>Area</th><th>Claim</th><th>Status</th><th>Notes</th></tr></thead>
<tbody>
${papers.map(paperRow).join('\n')}
</tbody>
</table>
</div>`;
}

function renderBenchmarks(data) {
  const head = data.columns.map((c) => `<th>${esc(c)}</th>`).join('');
  const rows = data.rows
    .map(
      (r) =>
        `<tr><td>${esc(r.benchmark)}</td><td><span class="tag">${esc(r.repo)}</span></td><td><code>${esc(r.command)}</code></td><td>${esc(r.dev)}</td><td>${esc(r.laptop)}</td><td>${esc(r.notes)}${r.evidence ? `${r.notes ? ' ' : ''}Evidence: ${esc(r.evidence)}.` : ''}</td></tr>`,
    )
    .join('\n');
  return `<p class="muted">${esc(data.note)}</p>
<div class="table-wrap">
<table class="benchmarks">
<thead><tr>${head}</tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>`;
}

const fmtNum = (n) => Number(n).toLocaleString('en-US');
const mbOf = (bytes) => `${fmtNum(Math.round(bytes / 1048576))} MiB`;
/** "median / worst" for a stat object, or 'not measured' when the figure is absent for some run of the group. */
const medianWorst = (st, unit) => (st === null || st === undefined ? 'not measured' : unit === 'MiB' ? `${mbOf(st.median)} / ${mbOf(st.worst)}` : `${fmtNum(st.median)} ms / ${fmtNum(st.worst)} ms`);

export const E2E_LIMITATIONS = [
  'Text-layer PDFs only. OCR is not yet supported: a scanned PDF is refused, and image-only pages are skipped.',
  'The model is Qwen3-0.6B, a small demo model, and not the pilot model (Qwen3-1.7B, hosted by the customer). Its answers can be wrong.',
  'Single-threaded WebAssembly: the page is not cross-origin isolated (GitHub Pages cannot send the headers), so the engine runs on one thread.',
  'The origin is shared: the demos of this lab all live on airplanemode-labs.github.io, so storage and quota are shared between them.',
  'The test document is a synthetic English policy, and the question set is seven fixed questions over it. A result here says nothing about real documents.',
  'Hindi answer quality is not measured: only the gate that tells clean from damaged Devanagari text layers is tested.',
  'Not measured on 8 GB. Every figure here is from the machine named in its row; the 8 GB laptop column reads not measured on 8 GB.',
];

/** The dockit end-to-end section, built from data/e2e.json only: every number on it is a value of that file. */
export function renderE2e(e2e) {
  const g = e2e.groups;
  const rows = g
    .map(
      (r) =>
        `<tr><td>${esc(r.machine)}</td><td>${r.restart ? 'after a full Chrome restart, same profile' : 'one Chrome session, model cached'}</td><td>${fmtNum(r.runs)}</td>` +
        `<td>${medianWorst(r.first_token_ms)}</td><td>${medianWorst(r.total_ms)}</td>` +
        `<td>${medianWorst(r.process_rss_peak_bytes, 'MiB')}</td><td>${medianWorst(r.js_heap_peak_bytes, 'MiB')}</td><td>${medianWorst(r.wasm_memory_peak_bytes, 'MiB')}</td>` +
        `<td>${medianWorst(r.storage_usage_bytes, 'MiB')}</td><td>${fmtNum(r.requests_after_offline.max)}</td>` +
        `<td>${esc(r.model)}; ${esc(r.backend)}</td><td><code>${esc(e2e.command)}</code></td><td><code>${esc(r.commit)}</code>, ${esc(r.chrome)}</td><td>${esc(r.laptop8gb)}</td></tr>`,
    )
    .join('\n');
  const q = e2e.questions;
  const answerable = q.perQuestion.filter((x) => x.answerable);
  return `<h2 id="dockit-e2e">dockit: an answer over a PDF, in the browser, offline</h2>
<p>
  <span class="tag">dockit</span> A PDF goes through pagetriage (what is on each page), text extraction, the glyphsift gate, localdata chunks and vectors, and a
  small local model, in installed Chrome with the network blocked after the assets are cached. The command for every row is <code>${esc(e2e.command)}</code>;
  the raw rows are in dockit's <code>${esc(e2e.source.csv)}</code> (sha256 <code>${esc(e2e.source.csvSha256.slice(0, 16))}</code>) and
  <code>${esc(e2e.source.questionsCsv)}</code> (sha256 <code>${esc(e2e.source.questionsCsvSha256.slice(0, 16))}</code>), taken at commit <code>${esc(e2e.source.commit)}</code>.
  Each time is the median and the worst of the runs in its row; no run was left out.
</p>
<div class="table-wrap">
<table class="benchmarks e2e">
<thead><tr><th>Machine</th><th>Run kind</th><th>Runs</th><th>Time to first token (median / worst)</th><th>Total, first question (median / worst)</th><th>Peak memory: Chrome process tree, summed resident size (median / worst)</th><th>JS heap peak, main thread (median / worst)</th><th>WebAssembly memory peak, workers (median / worst)</th><th>Storage used (median / worst)</th><th>Requests after offline</th><th>Model and backend</th><th>Command</th><th>Commit, Chrome</th><th>8 GB laptop</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
<p class="muted">
  Peak memory is the peak summed resident size of the test Chrome's processes (browser, GPU, utility and renderer); a page shared between processes is
  counted in each. The JS heap and the workers' WebAssembly memory are different figures and are shown under their own names.
</p>
<p class="muted">
  Requests after offline counts application requests: those made by the page, its workers and its service worker, as the largest count of network requests
  attempted after the network was blocked. The browser itself may still check /dockit/sw.js for an update and fetch the favicon; this count does not include
  those two requests, and dockit's code makes neither of them.
</p>
<h3>Question set</h3>
<p>
  Seven fixed questions over a synthetic three-page policy, six with an answer on a known page and one with no answer in the document.
  Correct means the answer holds the expected text and a source the answer cites names the page that holds it.
  First run: <strong>${fmtNum(q.firstRun.correct)} of ${fmtNum(q.firstRun.of)}</strong> correct with the correct source page.
  Over all ${fmtNum(q.all.runs)} runs, counting every run of every question with none selected: <strong>${fmtNum(q.all.correct)} of ${fmtNum(q.all.of)}</strong>.
  The question with no answer was refused in ${fmtNum(q.unanswerable.refused)} of ${fmtNum(q.unanswerable.of)} runs.
</p>
<p>
  Two page columns are kept apart. A cited source on the right page was shown in ${fmtNum(q.citedPage.ok)} of ${fmtNum(q.citedPage.of)} answerable rows: a refused answer cites nothing,
  so it never counts there. The top-ranked retrieved passage was on the right page in ${fmtNum(q.topRetrieved.ok)} of ${fmtNum(q.topRetrieved.of)} (retrieval quality, reported on its own).
</p>
<div class="table-wrap">
<table class="benchmarks">
<thead><tr><th>Question</th><th>Runs</th><th>Answer correct</th><th>Cited source page correct</th><th>Top-ranked retrieved passage on the right page</th><th>Time to first token (median / worst)</th><th>8 GB laptop</th></tr></thead>
<tbody>
${answerable.map((x) => `<tr><td>${esc(x.qid)}</td><td>${fmtNum(x.runs)}</td><td>${fmtNum(x.answerOk)}</td><td>${fmtNum(x.pageOk)}</td><td>${fmtNum(x.topRetrievedOk)}</td><td>${medianWorst(x.first_token_ms)}</td><td>${esc(x.laptop8gb)}</td></tr>`).join('\n')}
</tbody>
</table>
</div>
<p class="box" id="dockit-done-when"><strong>Done-when:</strong> build done on Apple M5 Pro 48 GB; 8 GB Windows done-when NOT met (owner runbook step 5).</p>
<h3>Limitations</h3>
<ul>
${E2E_LIMITATIONS.map((l) => `<li>${esc(l)}</li>`).join('\n')}
</ul>`;
}

/** The first-session group of a set (the five-run row, not the run after a Chrome restart). */
const sessionGroup = (set) => set.groups.find((g) => g.restart === false);
const mibOf = (bytes) => Math.round(bytes / 1048576);

/**
 * The memory hardening section (B1, TD-66): the dockit baseline taken before the measures and the after set, from data/e2e.json only. The outcome of
 * the target is computed from the two sets and worded without the word "met" (nothing on the benchmarks page may call a done-when met).
 */
export function renderMemory(e2e) {
  const base = e2e.baseline;
  const t = e2e.target;
  if (!base || !t) throw new Error('data/e2e.json has no baseline and target: run scripts/import-dockit-bench.mjs with --baseline-from');
  const rowOf = (label, set) => {
    const g = sessionGroup(set);
    const q = set.questions;
    return (
      `<tr><td>${esc(label)}</td><td>${fmtNum(g.runs)}</td>` +
      `<td>${medianWorst(g.process_rss_peak_bytes, 'MiB')}</td><td>${medianWorst(g.first_token_ms)}</td><td>${medianWorst(g.total_ms)}</td>` +
      `<td>${medianWorst(q.timing.total_ms)}</td>` +
      `<td>${fmtNum(q.firstRun.correct)} of ${fmtNum(q.firstRun.of)} first run, ${fmtNum(q.all.correct)} of ${fmtNum(q.all.of)} over all runs</td>` +
      `<td>${fmtNum(g.requests_after_offline.max)}</td><td><code>${esc(e2e.command)}</code></td><td><code>${esc(g.commit)}</code></td><td>${esc(g.laptop8gb)}</td></tr>`
    );
  };
  const b = sessionGroup(base);
  const a = sessionGroup(e2e);
  // BUG-T1-S6-04: one rounding rule: the fall and its percentage come from the exact medians (bytes, then MiB), and are rounded only when written
  const baseMib = mibOf(b.process_rss_peak_bytes.median);
  const afterMib = mibOf(a.process_rss_peak_bytes.median);
  const baseExact = b.process_rss_peak_bytes.median / 1048576;
  const diffExact = baseExact - a.process_rss_peak_bytes.median / 1048576;
  const diff = Math.round(diffExact);
  const pct = baseExact === 0 ? '0' : ((Math.abs(diffExact) / baseExact) * 100).toFixed(1);
  const rssReached = a.process_rss_peak_bytes.median / 1048576 <= t.rssMedianMiB;
  const timeReached = e2e.questions.timing.total_ms.median <= t.totalMedianMs;
  const qa = e2e.questions;
  const questionsOk = qa.firstRun.correct >= t.questionFirstRunMin && qa.all.correct >= t.questionAllMin;
  const noRequests = [...base.groups, ...e2e.groups].every((g) => g.requests_after_offline.max === 0);
  return `<h2 id="memory-hardening">Memory hardening (Sprint 6)</h2>
<p>
  <span class="tag">dockit</span> Sprint 6 loads one model at a time: the search model is unloaded before the answer model is loaded and the answer model before the next
  question, and the analysis and PDF workers end when their stage ends. Before and after were measured on the same machine with the same command, <code>${esc(e2e.command)}</code>;
  the raw rows are in dockit's <code>${esc(base.source.csv)}</code> (sha256 <code>${esc(base.source.csvSha256.slice(0, 16))}</code>) before and
  <code>${esc(e2e.source.csv)}</code> (sha256 <code>${esc(e2e.source.csvSha256.slice(0, 16))}</code>) after. Each row is the median and the worst of the runs of one Chrome session; no run was left out.
</p>
<div class="table-wrap">
<table class="benchmarks memory">
<thead><tr><th>Run</th><th>Runs</th><th>Peak memory: Chrome process tree, summed resident size (median / worst)</th><th>Time to first token (median / worst)</th><th>Total, first question (median / worst)</th><th>Per-question total, every question of every run (median / worst)</th><th>Question set</th><th>Requests after offline</th><th>Command</th><th>Commit</th><th>8 GB laptop</th></tr></thead>
<tbody>
${rowOf('Before: the Sprint 5 pipeline, both models loaded together', base)}
${rowOf('After: one model at a time', e2e)}
</tbody>
</table>
</div>
<p>
  The target stated before measuring (TD-66) was a median peak of at most ${fmtNum(t.rssMedianMiB)} MiB, with the question set no worse than ${fmtNum(t.questionAllMin)} of 36 over all runs and ${fmtNum(t.questionFirstRunMin)} of 6 on the first run, and a median per-question total of at most ${fmtNum(t.totalMedianMs)} ms.
  The median peak went from ${fmtNum(baseMib)} MiB to ${fmtNum(afterMib)} MiB, a ${diffExact >= 0 ? 'fall' : 'rise'} of ${fmtNum(Math.abs(diff))} MiB (${pct} percent). Each median is the median of the ${fmtNum(a.runs)} in-session runs; the run after a Chrome restart is shown separately. Differences and percentages are computed from the exact medians (the exact fall is ${diffExact.toFixed(1)} MiB, shown as ${fmtNum(diff)}) and then rounded, so a difference can differ by 1 MiB from the subtraction of the two rounded medians.
  ${rssReached ? 'The target was reached' : 'The target was not reached'} for memory; the question set was ${questionsOk ? 'not worse than the floor' : 'worse than the floor'}; the time guard was ${timeReached ? 'reached' : 'not reached'}; ${noRequests ? 'every run made 0 requests after the network was blocked' : 'a run made a request after the network was blocked'}.
</p>
<p>
  Process-tree peaks are comparable only between runs on a quiet host: a run taken while the machine is busy (a high load average, recorded in the host_load_1m_start and host_load_1m_end columns of newer CSVs) can read lower or higher than the same build on a quiet host. The stated figure is the quiet-host one.
</p>
<p class="muted">
  These are figures from one Apple M5 Pro 48 GB, with Chrome's processes summed and a page shared between processes counted in each. They say nothing about an 8 GB laptop:
  the 8 GB column reads not measured on 8 GB in every row, and whether the demo fits an 8 GB Windows laptop is exactly what the owner's run measures.
</p>`;
}

const fmtAnn = (n) => (Number.isInteger(n) ? fmtNum(n) : String(Number(n.toFixed(4))));
/** "median unit / worst unit" for a data-file stat, or 'not measured' when a run of the group lacks the figure. */
const annPair = (st, unit) => (st === null || st === undefined ? 'not measured' : unit === 'MiB' ? `${mbOf(st.median)} / ${mbOf(st.worst)}` : unit === 'bytes' ? `${fmtNum(st.median)} B / ${fmtNum(st.worst)} B` : unit === '' ? `${fmtAnn(st.median)} / ${fmtAnn(st.worst)}` : `${fmtAnn(st.median)} ${unit} / ${fmtAnn(st.worst)} ${unit}`);

/**
 * The flat-against-HNSW section (B2, TD-65, TD-76), from data/ann.json only. The recall target is a number of the data (fixed by TD-65 before anything was
 * measured) and its outcome is computed from the clustered group at the target ef, in words that are not "met".
 */
export function renderAnn(ann) {
  const rows = ann.groups
    .map(
      (g) =>
        `<tr><td>${esc(g.data)}</td><td>${g.index === 'flat' ? 'flat' : `hnsw, ef ${fmtNum(g.ef)}`}</td><td>${fmtNum(g.runs)}</td>` +
        `<td>${annPair(g.build_ms, 'ms')}</td><td>${annPair(g.query_p50_ms, 'ms')}</td><td>${annPair(g.query_p95_ms, 'ms')}</td><td>${annPair(g.recall_at_10, '')}</td>` +
        `<td>${annPair(g.index_bytes, 'MiB')}</td><td>${annPair(g.ann_bytes, 'MiB')}</td><td>${annPair(g.js_heap_peak_bytes, 'MiB')}</td><td>${annPair(g.wasm_memory_bytes, 'MiB')}</td>` +
        `<td>${esc(g.machine)}, ${esc(g.chrome)}</td><td><code>${esc(g.command)}</code></td><td><code>${esc(g.commit)}</code></td><td>${esc(g.eight_gb)}</td></tr>`,
    )
    .join('\n');
  const t = ann.target;
  const at = ann.groups.find((g) => g.data === 'clustered' && g.index === 'hnsw' && g.ef === t.ef);
  const outcome = at === undefined || at.recall_at_10 === null ? 'The recall target was not measured' : at.recall_at_10.median >= t.recallAtTenMin ? 'The recall target was reached' : 'The recall target was not reached';
  return `<h2 id="vector-search">Vector search: flat against HNSW at 100,000 x 384</h2>
<p>
  <span class="tag">localdata</span> The flat index scans every vector and is exact; the HNSW graph is a derived index that the caller builds, that answers from a few hundred candidates, and that
  falls back to the flat scan when it is missing, stale or refused. Every HNSW hit is scored again with the flat scoring function, so a hit is a row of the true ranking with its exact
  score and recall is the only difference. Recall@10 is measured against the flat scan as the ground truth. The raw rows are in localdata's <code>${esc(ann.source.csv)}</code>
  (sha256 <code>${esc(ann.source.csvSha256.slice(0, 16))}</code>), taken at commit <code>${esc(ann.source.commit)}</code>. Each row is the median and the worst of its runs; for recall the worst is the lowest.
</p>
<div class="table-wrap">
<table class="benchmarks ann">
<thead><tr><th>Data</th><th>Index</th><th>Runs</th><th>Build, flat write or graph build (median / worst)</th><th>Query p50 (median / worst)</th><th>Query p95 (median / worst)</th><th>Recall@10 (median / lowest)</th><th>Index bytes, vectors (median / worst)</th><th>Graph bytes (median / worst)</th><th>JS heap peak (median / worst)</th><th>WebAssembly memory (median / worst)</th><th>Machine, Chrome</th><th>Command</th><th>Commit</th><th>8 GB laptop</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
<p>
  The recall target fixed by ${esc(t.decision)} before anything was measured was a recall@10 of at least ${t.recallAtTenMin.toFixed(2)} at ef ${fmtNum(t.ef)} on the clustered set.
  ${outcome}${at && at.recall_at_10 ? `: the median recall at ef ${fmtNum(t.ef)} was ${fmtAnn(at.recall_at_10.median)} and the lowest of its runs ${fmtAnn(at.recall_at_10.worst)}` : ''}.
  The clustered set is the test set fixed in advance; the uniform set, where it appears, is the worst case for any graph index and has no floor.
</p>
<p class="muted">
  Quantisation, compaction and encryption at rest are not yet. The figures are from one Apple-silicon machine: the 8 GB column reads not measured on 8 GB in every row, and nothing here is a figure for an 8 GB laptop.
</p>`;
}

const GITHUB_ORG = 'https://github.com/AirplaneMode-Labs';
const DEMO_URL = /^https:\/\/airplanemode-labs\.github\.io\/[a-z]+\/$/;

/** Throws when demos.json is not exactly the six expected entries with consistent URLs. */
export function checkDemos(demos) {
  if (!Array.isArray(demos) || demos.length !== 6) throw new Error('demos.json must list exactly six demos');
  const seen = new Set();
  for (const d of demos) {
    for (const k of ['repo', 'url', 'status', 'writtenOn']) {
      if (typeof d[k] !== 'string' || d[k].length === 0) throw new Error(`demos.json: ${d.repo ?? '?'} lacks ${k}`);
    }
    if (seen.has(d.repo)) throw new Error(`demos.json: duplicate repo ${d.repo}`);
    seen.add(d.repo);
    if (!DEMO_URL.test(d.url) || d.url !== `https://airplanemode-labs.github.io/${d.repo}/`) {
      throw new Error(`demos.json: ${d.repo} url must be https://airplanemode-labs.github.io/${d.repo}/`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.writtenOn)) throw new Error(`demos.json: ${d.repo} writtenOn is not a date`);
  }
}

/** Shows an ISO date as "9 Nov 2026". */
function humanDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}

function renderDemos(demos) {
  const rows = demos
    .map(
      (d) =>
        `<tr class="demo" data-repo="${esc(d.repo)}"><td><a href="${esc(`${GITHUB_ORG}/${d.repo}`)}" rel="noopener noreferrer">${esc(d.repo)}</a></td><td><a href="${esc(d.url)}">${esc(d.url)}</a></td><td class="demo-status">${esc(d.status)}</td><td class="demo-date">${esc(humanDate(d.writtenOn))}</td></tr>`,
    )
    .join('\n');
  return `<div class="table-wrap">
<table class="demos">
<thead><tr><th>Repo</th><th>Demo</th><th>Status</th><th>Status written on</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>`;
}

function renderDemosHome(demos) {
  const dates = [...new Set(demos.map((d) => d.writtenOn))].map(humanDate).join(', ');
  const items = demos
    .map((d) => `  <li><a href="${esc(d.url)}">${esc(d.repo)}</a>: ${esc(d.status)}</li>`)
    .join('\n');
  return `<h2>Demos</h2>
<ul class="demo-list">
${items}
</ul>
<p class="muted">Statuses written on ${esc(dates)} from local builds, not measured at the live URLs. See the <a href="demos/">demos page</a>.</p>`;
}

const LICENCE_REPOS = ['pagetriage', 'glyphsift', 'localdata', 'runtime', 'dockit', 'site', 'control-plane'];

/** Throws unless licences.json lists exactly the seven repos, in order, with a licence each. */
export function checkLicences(data) {
  const repos = data?.repos;
  if (!Array.isArray(repos) || repos.map((r) => r.repo).join() !== LICENCE_REPOS.join()) {
    throw new Error('licences.json must list exactly the seven repos in the fixed order');
  }
  for (const r of repos) {
    for (const k of ['licence', 'visibility', 'note']) {
      if (typeof r[k] !== 'string' || r[k].length === 0) throw new Error(`licences.json: ${r.repo} lacks ${k}`);
    }
  }
}

function renderLicences(data) {
  const rows = data.repos
    .map(
      (r) =>
        `<tr class="licence" data-repo="${esc(r.repo)}"><td>${esc(r.repo)}</td><td>${esc(r.licence)}</td><td>${esc(r.visibility)}</td><td>${esc(r.note)}</td></tr>`,
    )
    .join('\n');
  return `<div class="table-wrap">
<table class="licences">
<thead><tr><th>Repo</th><th>Licence</th><th>Visibility</th><th>Note</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>`;
}

export function build({ root, outDir }) {
  const srcDir = join(root, 'src');
  const layout = readFileSync(join(srcDir, 'templates', 'layout.html'), 'utf8');
  const built = `${buildId({ root })} \u00b7 ${new Date().toISOString().slice(0, 10)}`;
  const outputs = [];

  const emit = (relPath, title, description, content, depth, active, draft = false) => {
    const rel = '../'.repeat(depth);
    const html = renderLayout(layout, { title, description, content, root: rel, active, built, draft });
    checkOutput(html, relPath);
    outputs.push([relPath, html]);
  };

  // Pages
  const pagesDir = join(srcDir, 'pages');
  const papers = JSON.parse(readFileSync(join(root, 'data', 'papers.json'), 'utf8'));
  const benchmarks = JSON.parse(readFileSync(join(root, 'data', 'benchmarks.json'), 'utf8'));
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  checkDemos(demos);
  const e2e = JSON.parse(readFileSync(join(root, 'data', 'e2e.json'), 'utf8'));
  const licences = JSON.parse(readFileSync(join(root, 'data', 'licences.json'), 'utf8'));
  checkLicences(licences);
  for (const file of readdirSync(pagesDir).filter((f) => f.endsWith('.html')).sort()) {
    const name = basename(file, '.html');
    const { draft, fragment } = takeDraft(readFileSync(join(pagesDir, file), 'utf8'));
    const title = readMeta(fragment, 'title', name);
    const description = readMeta(fragment, 'description', 'Airplane Mode Labs');
    let content = stripMeta(fragment);
    if (content.includes('{{benchmarks-table}}')) {
      content = content.replace('{{benchmarks-table}}', () => renderBenchmarks(benchmarks));
    }
    if (content.includes('{{e2e-section}}')) {
      content = content.replace('{{e2e-section}}', () => renderE2e(e2e));
    }
    if (content.includes('{{memory-section}}')) {
      content = content.replace('{{memory-section}}', () => renderMemory(e2e));
    }
    if (content.includes('{{ann-section}}')) {
      content = content.replace('{{ann-section}}', () => renderAnn(JSON.parse(readFileSync(join(root, 'data', 'ann.json'), 'utf8'))));
    }
    if (content.includes('{{licences-table}}')) {
      content = content.replace('{{licences-table}}', () => renderLicences(licences));
    }
    if (content.includes('{{demos-table}}')) {
      content = content.replace('{{demos-table}}', () => renderDemos(demos));
    }
    if (content.includes('{{demos-written}}')) {
      const dates = [...new Set(demos.map((d) => d.writtenOn))].map(humanDate).join(', ');
      content = content.replace('{{demos-written}}', () => dates);
    }
    if (content.includes('{{demos-home}}')) {
      content = content.replace('{{demos-home}}', () => renderDemosHome(demos));
    }
    if (name === 'index') emit('index.html', title, description, content, 0, 'index', draft);
    else emit(join(name, 'index.html'), title, description, content, 1, name, draft);
  }

  // Papers
  emit(
    join('papers', 'index.html'),
    'Papers',
    'The Airplane Mode Labs reading list: each paper with its claim, our status and notes.',
    renderPapers(papers),
    1,
    'papers',
  );

  // Write-ups
  const wuDir = join(root, 'writeups');
  const writeups = existsSync(wuDir) ? readdirSync(wuDir).filter((f) => f.endsWith('.html')).sort().reverse() : [];
  const items = [];
  for (const file of writeups) {
    const slug = basename(file, '.html');
    const { draft, fragment } = takeDraft(readFileSync(join(wuDir, file), 'utf8'));
    const title = readMeta(fragment, 'title', slug);
    const date = readMeta(fragment, 'date', '');
    const description = readMeta(fragment, 'description', title);
    emit(join('writeups', slug, 'index.html'), title, description, stripMeta(fragment), 2, 'writeups', draft);
    if (draft) continue; // drafts are reachable by direct URL only
    items.push(`<li><a href="${esc(slug)}/">${esc(title)}</a>${date ? ` <span class="muted">${esc(date)}</span>` : ''}</li>`);
  }
  const wuIndex = `<h1>Write-ups</h1>
<p class="lede">What a paper claimed, what held up, what did not. Numbers are quoted with the command that
produced them. Prose is CC BY 4.0.</p>
${items.length ? `<ul class="writeup-list">\n${items.join('\n')}\n</ul>` : '<p class="muted">No write-ups yet.</p>'}`;
  emit(join('writeups', 'index.html'), 'Write-ups', 'Airplane Mode Labs write-ups.', wuIndex, 1, 'writeups');

  // Write everything only after every page passed the checks.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const [relPath, html] of outputs) {
    mkdirSync(dirname(join(outDir, relPath)), { recursive: true });
    writeFileSync(join(outDir, relPath), html);
  }
  const css = readFileSync(join(srcDir, 'styles.css'), 'utf8');
  if (/@import|url\(\s*["']?https?:/i.test(css)) throw new Error('refusing to build: styles.css loads a remote resource');
  copyFileSync(join(srcDir, 'styles.css'), join(outDir, 'styles.css'));
  copyFileSync(join(srcDir, 'favicon.svg'), join(outDir, 'favicon.svg'));
  // The header mark comes from brand/, the canonical logo folder every repo copies from.
  // Test fixtures build from a synthetic root without brand/; the real site always has it.
  const mark = join(root, 'brand', 'airplanemode-labs-mark.svg');
  if (existsSync(mark)) {
    mkdirSync(join(outDir, 'brand'), { recursive: true });
    copyFileSync(mark, join(outDir, 'brand', 'mark.svg'));
  }
  writeFileSync(join(outDir, '.nojekyll'), '');
  return { pages: outputs.length, papers: papers.length, writeups: writeups.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = process.argv[2] ? process.argv[2] : join(root, 'dist');
  const result = build({ root, outDir });
  console.log(`build: ${result.pages} pages, ${result.papers} papers, ${result.writeups} write-ups -> ${outDir}`);
}
