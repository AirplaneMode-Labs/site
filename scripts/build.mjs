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
 * `git` is injectable for the tests.
 */
export function buildId({ sha = process.env.GITHUB_SHA, ref = process.env.GITHUB_REF, root, git = runGit } = {}) {
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
