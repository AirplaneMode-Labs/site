import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build, buildId, checkDemos, ALLOWED_RESOURCE_HOSTS } from '../scripts/build.mjs';
import { readSibling, readCitation, evidenceExists, readLanded, cutText, mode as siblingMode, SPRINT } from '../scripts/sibling-fixtures.mjs';
import { dateOfLine, defaultFrom, sync as syncDemoStatus, SOURCES as STATUS_SOURCES } from '../scripts/sync-demo-status.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

function buildToTemp() {
  const out = mkdtempSync(join(tmpdir(), 'amlabs-site-'));
  const result = build({ root, outDir: out });
  return { out, result };
}

test('build produces the expected pages and .nojekyll', () => {
  const { out } = buildToTemp();
  for (const f of ['index.html', 'demos/index.html', 'papers/index.html', 'benchmarks/index.html', 'writeups/index.html', 'styles.css', 'favicon.svg', 'brand/mark.svg', '.nojekyll']) {
    assert.ok(existsSync(join(out, f)), `${f} missing`);
  }
});

// Sprint 4 papers task (D5-02): the 30 original entries plus the entries verified on 14 Nov 2026
// against their primary page (research/plan-validation-2026-11-14.md section 3). The list is pinned so a
// dropped or silently added entry fails the build. Left-out items are named in the lane report.
const BASE_PAPERS = 30;
const NEW_PAPER_IDS = [
  'intelligence-per-watt-2025',
  'minions-2025',
  'slm-agentic-ai-2025',
  'ohrbench-2024',
  'ocr-vlms-devanagari-2026',
  'chitrapathak-2026',
  'seeing-straight-orb-2025',
  'quality-at-a-glance-2021',
  'fineweb2-2025',
  'glotlid-2023',
  'indicllmsuite-2024',
  'milu-2024',
  'micronn-2025',
  'leann-2025',
  'edgerag-2024',
  'rabitq-2024',
  'matryoshka-2022',
  'diskann-2019',
  'bm25-2009',
  'rrf-2009',
  'embeddinggemma-2025',
  'mmteb-2025',
  'tuf-2010',
  'in-toto-2019',
  'sigstore-2022',
  'prompt-injection-indirect-2023',
  'camel-2025',
  'injection-design-patterns-2025',
  'webllm-2024',
  'xgrammar-2024',
  'smollm2-2025',
  'qwen3-2025',
  'ragas-2023',
  'alce-2023',
  'local-first-2019',
];
const TOTAL_PAPERS = BASE_PAPERS + NEW_PAPER_IDS.length;
const REPOS = ['pagetriage', 'glyphsift', 'localdata', 'runtime', 'dockit', 'site', 'control-plane'];
const normTitle = (t) => t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

test(`papers page lists exactly ${TOTAL_PAPERS} papers (30 + ${NEW_PAPER_IDS.length} verified), each with a status and an area`, () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'papers', 'index.html'), 'utf8');
  const rows = [...html.matchAll(/<tr class="paper" data-status="([^"]*)" data-area="([^"]*)"/g)];
  assert.equal(rows.length, TOTAL_PAPERS);
  for (const [, status, area] of rows) {
    assert.ok(status.length > 0, 'empty status');
    assert.ok(area.length > 0, 'empty area');
  }
});

test('papers.json entries are well-formed and follow the citation rule', () => {
  const papers = JSON.parse(readFileSync(join(root, 'data', 'papers.json'), 'utf8'));
  assert.equal(papers.length, TOTAL_PAPERS);
  const ids = new Set();
  const STATUSES = new Set(['to-read', 'reading', 'read', 'reproducing', 'reproduced', 'not-reproduced', 'write-up']);
  for (const p of papers) {
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`);
    ids.add(p.id);
    for (const k of ['id', 'title', 'authors', 'year', 'area', 'claim', 'status', 'notes']) {
      assert.ok(k in p, `${p.id} lacks ${k}`);
    }
    assert.ok(STATUSES.has(p.status), `${p.id}: unknown status ${p.status}`);
    assert.ok(Array.isArray(p.authors) && p.authors.length > 0, `${p.id}: authors`);
    assert.ok(Number.isInteger(p.year) || p.year === null, `${p.id}: year`);
    const verified = p.url !== undefined || p.venue !== undefined;
    if (verified) {
      assert.match(p.notes, /citation verified/, `${p.id}: has url/venue but no 'citation verified' note`);
      if (p.url !== undefined) assert.match(p.url, /^https:\/\//, `${p.id}: url must be https`);
    } else {
      assert.equal(p.status, 'to-read', `${p.id}: unverified entries are to-read`);
      assert.match(p.notes, /citation to verify/, `${p.id}: unverified entries carry 'citation to verify'`);
    }
  }
});

test('Sprint 4 papers: the pinned new entries exist, are to-read, are tagged with a repo and carry a 14 Nov 2026 verification note', () => {
  const papers = JSON.parse(readFileSync(join(root, 'data', 'papers.json'), 'utf8'));
  const byId = new Map(papers.map((p) => [p.id, p]));
  for (const id of NEW_PAPER_IDS) {
    const p = byId.get(id);
    assert.ok(p, `${id}: missing from papers.json`);
    assert.equal(p.status, 'to-read', `${id}: new entries start to-read`);
    assert.ok(REPOS.includes(p.repo), `${id}: repo '${p.repo}' is not one of the seven repos`);
    assert.match(p.notes, /^citation verified 2026-11-14 against \S/, `${id}: note must start 'citation verified 2026-11-14 against <primary page>'`);
    assert.ok(typeof p.url === 'string' && typeof p.venue === 'string', `${id}: a verified entry carries url and venue`);
    assert.ok(Number.isInteger(p.year), `${id}: year`);
    assert.ok(p.claim.length > 20 && p.claim.length < 600, `${id}: claim length`);
    assert.ok(p.authors.every((a) => typeof a === 'string' && a.trim() !== ''), `${id}: authors`);
  }
  // Only the pinned ids were added: 30 originals stay, in front.
  assert.equal(papers.length, BASE_PAPERS + NEW_PAPER_IDS.length);
  assert.deepEqual(
    papers.slice(BASE_PAPERS).map((p) => p.id),
    NEW_PAPER_IDS,
    'new entries are appended after the 30 originals in the pinned order',
  );
});

test('papers.json has no duplicate id, url or normalised title, and every url is a well-formed https URL', () => {
  const papers = JSON.parse(readFileSync(join(root, 'data', 'papers.json'), 'utf8'));
  const seen = { id: new Set(), url: new Set(), title: new Set() };
  for (const p of papers) {
    assert.ok(!seen.id.has(p.id), `duplicate id ${p.id}`);
    seen.id.add(p.id);
    if (p.url !== undefined) {
      const u = new URL(p.url); // throws on a malformed URL
      assert.equal(u.protocol, 'https:', `${p.id}: url must be https`);
      assert.ok(u.hostname.includes('.'), `${p.id}: url host`);
      assert.equal(u.username + u.password, '', `${p.id}: url must not carry credentials`);
      const key = p.url.replace(/\/+$/, '').toLowerCase();
      assert.ok(!seen.url.has(key), `duplicate url ${p.url} (${p.id})`);
      seen.url.add(key);
    }
    const t = normTitle(p.title);
    assert.ok(!seen.title.has(t), `duplicate normalised title '${t}' (${p.id})`);
    seen.title.add(t);
  }
});

test('Sprint 4 papers: no new entry is a standard or an unconfirmed item (those are listed in the lane report, not added)', () => {
  const papers = JSON.parse(readFileSync(join(root, 'data', 'papers.json'), 'utf8'));
  const ids = new Set(papers.map((p) => p.id));
  for (const standard of ['cyclonedx-ml-bom', 'cert-in-aibom', 'openssf-model-signing-v1', 'owasp-llm01-2025']) {
    assert.ok(!ids.has(standard), `${standard} is a standard and must not be added in Sprint 4`);
  }
  // The research list gave arXiv 2502.10361 for FineWeb2; that ID is a different paper. It must not be
  // recorded under the FineWeb2 name, and FineWeb2 is recorded under the ID its own page confirms.
  const fw2 = papers.find((p) => p.id === 'fineweb2-2025');
  assert.equal(fw2.url, 'https://arxiv.org/abs/2506.20920');
  assert.ok(!papers.some((p) => /2502\.10361/.test(`${p.url ?? ''} ${p.venue ?? ''}`)), 'arXiv 2502.10361 is not FineWeb2 and is not added');
});

test('external links carry rel="noopener noreferrer"', () => {
  const { out } = buildToTemp();
  let external = 0;
  for (const file of walk(out).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(file, 'utf8');
    for (const m of html.matchAll(/<a\s[^>]*href="(https?:\/\/[^"]+)"[^>]*>/g)) {
      const host = new URL(m[1].replace(/&amp;/g, '&')).hostname;
      if (host === 'airplanemode-labs.github.io') continue; // same origin as the site (demos)
      external += 1;
      const rel = /\srel="([^"]*)"/.exec(m[0])?.[1] ?? '';
      assert.ok(/\bnoopener\b/.test(rel) && /\bnoreferrer\b/.test(rel), `${file}: external link without rel="noopener noreferrer": ${m[1]}`);
    }
  }
  assert.ok(external > 30, 'the check must actually see the external links');
});

test('no page contains a script tag, a third-party asset or an inline style attribute', () => {
  const { out } = buildToTemp();
  for (const file of walk(out).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(file, 'utf8');
    assert.doesNotMatch(html, /<script/i, `${file} has <script`);
    assert.doesNotMatch(html, /fonts\.googleapis|googletagmanager|analytics/i, `${file} has a tracker or font CDN`);
    assert.doesNotMatch(html, /<(?:link|script)[^>]+(?:href|src)="https?:\/\//i, `${file} loads a remote asset`);
    assert.doesNotMatch(html, /\sstyle="/i, `${file} has an inline style attribute`);
    assert.match(html, /<meta\s+http-equiv="Content-Security-Policy"/, `${file} lacks the CSP meta`);
    assert.match(html, /<meta name="referrer" content="no-referrer"/, `${file} lacks the referrer meta`);
  }
  const css = readFileSync(join(out, 'styles.css'), 'utf8');
  assert.doesNotMatch(css, /@import|url\(\s*["']?https?:/i, 'styles.css loads something remote');
});

test('benchmarks page carries the 8 GB laptop columns; figures appear only in rows that name their evidence', () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'benchmarks', 'index.html'), 'utf8');
  assert.match(html, /8 GB Windows/);
  assert.match(html, /not measured/);
  // the dockit end-to-end section has its own checks (every number in it is a value of data/e2e.json, and it cites its CSV)
  const main = html.split('<h2 id="dockit-e2e">')[0];
  for (const row of main.match(/<tr><td>.*?<\/tr>/gs) ?? []) {
    if (/\d+(\.\d+)?\s*(MB\/s|tok\/s|ms)\b/.test(row)) {
      assert.match(row, /Evidence: (<a href="https:\/\/github\.com\/AirplaneMode-Labs\/(pagetriage|glyphsift|localdata|runtime|dockit)\/blob\/main\/docs\/benchmarks\/|evidence\/sprint-\d\/)/, `a figure appeared without its evidence: ${row}`);
      assert.match(row, /Measured \d{4}-\d{2}-\d{2}[^<]*, commit [^<]+, [^<]+\./, `a figure appeared without the date, commit and machine it was measured on: ${row}`);
    }
  }
});

test('build refuses a page with a script tag', () => {
  const bad = mkdtempSync(join(tmpdir(), 'amlabs-site-bad-'));
  cpSync(join(root, 'src'), join(bad, 'src'), { recursive: true });
  cpSync(join(root, 'data'), join(bad, 'data'), { recursive: true });
  mkdirSync(join(bad, 'writeups'));
  writeFileSync(join(bad, 'src', 'pages', 'evil.html'), '<!-- title: evil -->\n<p>x</p><script>alert(1)</script>');
  assert.throws(() => build({ root: bad, outDir: join(bad, 'dist') }), /refusing|<script/i);
});

test('build refuses a stylesheet from a non-allowed host', () => {
  const bad = mkdtempSync(join(tmpdir(), 'amlabs-site-bad-'));
  cpSync(join(root, 'src'), join(bad, 'src'), { recursive: true });
  cpSync(join(root, 'data'), join(bad, 'data'), { recursive: true });
  mkdirSync(join(bad, 'writeups'));
  writeFileSync(join(bad, 'src', 'pages', 'evil.html'), '<!-- title: evil -->\n<link rel="stylesheet" href="https://fonts.googleapis.com/css">');
  assert.throws(() => build({ root: bad, outDir: join(bad, 'dist') }), /refusing/i);
  assert.ok(ALLOWED_RESOURCE_HOSTS.includes('github.com'));
});

test('build refuses an inline style attribute', () => {
  const bad = mkdtempSync(join(tmpdir(), 'amlabs-site-bad-'));
  cpSync(join(root, 'src'), join(bad, 'src'), { recursive: true });
  cpSync(join(root, 'data'), join(bad, 'data'), { recursive: true });
  mkdirSync(join(bad, 'writeups'));
  writeFileSync(join(bad, 'src', 'pages', 'evil.html'), '<!-- title: evil -->\n<p style="color:red">x</p>');
  assert.throws(() => build({ root: bad, outDir: join(bad, 'dist') }), /refusing/i);
});

test('write-ups are rendered into dist/writeups/<slug>/ and listed', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'amlabs-site-wu-'));
  cpSync(join(root, 'src'), join(tmp, 'src'), { recursive: true });
  cpSync(join(root, 'data'), join(tmp, 'data'), { recursive: true });
  mkdirSync(join(tmp, 'writeups'));
  writeFileSync(join(tmp, 'writeups', '2026-11-example.html'), '<!-- title: Example write-up -->\n<!-- date: 2026-11-22 -->\n<h1>Example write-up</h1><p>Body.</p>');
  const out = join(tmp, 'dist');
  build({ root: tmp, outDir: out });
  assert.ok(existsSync(join(out, 'writeups', '2026-11-example', 'index.html')));
  assert.match(readFileSync(join(out, 'writeups', 'index.html'), 'utf8'), /Example write-up/);
});

test('the Sprint 1 write-up labels its figures as placeholders and states that nothing was tagged', () => {
  const html = readFileSync(join(root, 'writeups', '2026-11-sprint-1.html'), 'utf8');
  assert.match(html, /Apple-silicon development machine/);
  assert.match(html, /8 GB Windows laptop without a GPU has not been measured/);
  assert.match(html, /pagetriage v1\.0\.0 was not tagged/);
  assert.match(html, /Rows 1 \(/);
  for (const row of ['2 (', '4 (', '5 (', '6 (', '7 (']) assert.ok(html.includes(row), `row ${row} missing`);
  assert.doesNotMatch(html, /<script|\sstyle="|https?:\/\/(?!github\.com)/i);
});

test('the Sprint 1 write-up records the OPFS quota retest from T1 evidence and leaves the IndexedDB half open', () => {
  const html = readFileSync(join(root, 'writeups', '2026-11-sprint-1.html'), 'utf8');
  // Measured outcome (T1/report.md round-1 retest and retest1/t1-retest1-quota-opfs.json).
  assert.match(html, /evicted exactly B with reason <code>quota<\/code>/);
  assert.match(html, /left A and C\s+verified/);
  assert.match(html, /no <code>\.part<\/code> file/);
  assert.match(html, /9582 ms/);
  // Honesty about what is not yet proven.
  assert.match(html, /IndexedDB half did not evict/);
  assert.match(html, /T1R-01/);
  assert.match(html, /round-2 result (is|was) not yet in/);
  // The placeholder sentence is gone.
  assert.doesNotMatch(html, /will be recorded here/);
});

const DEMO_REPOS = ['pagetriage', 'runtime', 'glyphsift', 'localdata', 'dockit', 'site'];
const DEMO_URLS = DEMO_REPOS.map((r) => `https://airplanemode-labs.github.io/${r}/`);

// readLanded() comes from scripts/sibling-fixtures.mjs: D1's LANDED.json for Sprints 3 and 4 merged in order, read from
// the committed fixtures (or, for npm run test:siblings only, from the workspace evidence folder). It always exists.
const isGreen = (landed, k) =>
  landed !== undefined && (typeof landed[k] === 'string' ? landed[k].startsWith('green') : landed[k]?.status === 'green');

test('demos.json lists exactly the six demos with consistent URLs, statuses and one written-on date', () => {
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  assert.equal(demos.length, 6);
  assert.deepEqual(new Set(demos.map((d) => d.repo)), new Set(DEMO_REPOS));
  for (const d of demos) {
    assert.match(d.url, /^https:\/\/airplanemode-labs\.github\.io\/[a-z]+\/$/, `${d.repo}: url shape`);
    assert.equal(d.url, `https://airplanemode-labs.github.io/${d.repo}/`, `${d.repo}: url does not match repo`);
    assert.ok(typeof d.status === 'string' && d.status.length > 0, `${d.repo}: empty status`);
    assert.equal(d.writtenOn, '2026-11-20', `${d.repo}: writtenOn`);
  }
  assert.doesNotThrow(() => checkDemos(demos));
});

test('build refuses a demos list that is not the six expected entries', () => {
  assert.throws(() => checkDemos([]), /six/);
  assert.throws(
    () => checkDemos(DEMO_REPOS.map((repo) => ({ repo, url: `https://example.invalid/${repo}/`, status: 'x', writtenOn: '2026-11-09' }))),
    /url must be/,
  );
  assert.throws(
    () => checkDemos(DEMO_REPOS.map(() => ({ repo: 'site', url: 'https://airplanemode-labs.github.io/site/', status: 'x', writtenOn: '2026-11-09' }))),
    /duplicate/,
  );
});

test('the demos page lists all six URLs, heads the date column "Status written on" and never says "Checked"', () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'demos', 'index.html'), 'utf8');
  for (const u of DEMO_URLS) assert.ok(html.includes(`href="${u}"`), `${u} missing from demos page`);
  const found = [...html.matchAll(/https:\/\/airplanemode-labs\.github\.io\/[a-z]+\//g)].map((m) => m[0]);
  assert.deepEqual(new Set(found), new Set(DEMO_URLS));
  assert.match(html, /<th>Status written on<\/th>/);
  assert.doesNotMatch(html, /<th>[^<]*Checked[^<]*<\/th>/);
  assert.doesNotMatch(html, /\bChecked\b/);
  assert.match(html, /written on 20 Nov 2026 from local builds served under \/&lt;repo&gt;\//);
  assert.match(html, /nothing on this page was measured against the live URLs/);
  assert.equal((html.match(/<h2>What this demo does not do yet<\/h2>/g) ?? []).length, 1, 'exactly one not-yet heading');
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  // the build escapes & < > and " (a status line may quote a value such as index "hnsw")
  const escLine = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  for (const d of demos) assert.ok(html.includes(escLine(d.status)), `${d.repo}: status text missing`);
});

test('the home page has a Demos section with the six URLs before Repositories and the honesty line', () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  for (const u of DEMO_URLS) assert.ok(html.includes(`href="${u}"`), `${u} missing from home`);
  const demosAt = html.indexOf('<h2>Demos</h2>');
  const reposAt = html.indexOf('<h2>Repositories</h2>');
  assert.ok(demosAt > 0 && reposAt > demosAt, 'Demos section must precede Repositories');
  assert.match(html, /Statuses written on 20 Nov 2026 from local builds, not measured at the live URLs\./);
});

test('every page carries the Demos nav link resolving to the demos page', () => {
  const { out } = buildToTemp();
  const pages = walk(out).filter((f) => f.endsWith('.html'));
  assert.ok(pages.length >= 6);
  for (const file of pages) {
    const html = readFileSync(file, 'utf8');
    const m = /<a href="((?:\.\.\/)*)demos\/"[^>]*>Demos<\/a>/.exec(html);
    assert.ok(m, `${file} lacks the Demos nav link`);
    const target = join(dirname(file), m[1], 'demos', 'index.html');
    assert.ok(existsSync(target), `${file}: Demos link resolves to ${target}, which does not exist`);
  }
});

test('the Sprint 2 write-up is finished: honest-claim wording, every figure from saved evidence, no stray figures', () => {
  const html = readFileSync(join(root, 'writeups', '2026-11-sprint-2.html'), 'utf8');
  const flat = html.replace(/\s+/g, ' ');
  for (const sentence of [
    'Same prompt answered on WebGPU and on WebAssembly with the test model SmolLM2-135M-Instruct (q4), in Chrome on an Apple-silicon Mac only. This is not the Hindi production model; Windows and the 8 GB no-GPU laptop are not measured.',
    'Planned production model: Qwen3-1.7B (Apache-2.0), WebGPU q4f16 1.43 GB, WASM q8 1.74 GB. Provisional until the Sprint 5 measurement on an 8 GB laptop; contingency Qwen3-0.6B.',
    'Loaded once in a browser: a local, unscored WebGPU smoke run of five synthetic Hindi prompts on an Apple-silicon Mac, which needed ONNX Runtime graph optimisation turned off (evidence/sprint-2/D1/hindi-smoke.json).',
    'Hindi quality is not measured.',
  ]) {
    assert.ok(flat.includes(sentence), `missing: ${sentence}`);
  }
  assert.doesNotMatch(flat, /not yet loaded in a browser/);
  assert.doesNotMatch(flat, /to be filled/);
  assert.doesNotMatch(html, /<script|\sstyle="|https?:\/\//i);
  // Each result section names its command and the saved output its figures were copied from.
  assert.match(flat, /evidence\/sprint-2\/D3\/bench-run-1\.log/);
  assert.match(flat, /evidence\/sprint-2\/D1\/model-run\.json/);
  // The only figures allowed are these, copied from evidence/sprint-2/D3/bench-run-1.log (with
  // docs/score-vs-noise.csv) and evidence/sprint-2/D1/model-run.json. A new figure must be added here
  // deliberately, with its evidence.
  const FIGURES = [
    '1,000,000', '998,454', '996,931', '991,588', '983,739', '967,065', '932,405',
    '0.01', '0.02', '0.05', '0.1', '0.2', '0.4',
    '2,667 ms', '66 ms', '51 ms', '155.9 tokens', '2,592 ms', '368 ms', '732 ms', '10.9 tokens',
  ];
  let stripped = flat
    .replace(/<!--.*?-->/g, ' ')
    .replace(/Loaded once in a browser: a local, unscored WebGPU smoke run of five synthetic Hindi prompts on an Apple-silicon Mac, which needed ONNX Runtime graph optimisation turned off \(evidence\/sprint-2\/D1\/hindi-smoke\.json\)\./g, ' ')
    .replace(/<code>.*?<\/code>/g, ' ') // named commands and evidence paths
    .replace(/Planned production model: Qwen3-1\.7B.*?contingency Qwen3-0\.6B\./g, ' ')
    .replace(/SmolLM2-135M-Instruct/g, ' ')
    .replace(/Qwen3-(1\.7B|0\.6B)/g, ' ')
    .replace(/\b\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December)( \d{4})?\b/g, ' ')
    .replace(/\b\d{1,2} (to|and) \d{1,2} (November|December)( \d{4})?\b/g, ' ')
    .replace(/\bSprint \d\b/g, ' ')
    .replace(/\b8 GB\b/g, ' ')
    .replace(/\b[TDS]\d\b/g, ' ')
    .replace(/\bTD-08\b/g, ' ')
    .replace(/CC BY 4\.0/g, ' ')
    .replace(/\bq4f16\b|\bq4\b|\bq8\b/g, ' ')
    .replace(/SHA-256/g, ' ')
    .replace(/seeds 1 to 3/g, ' ')
    .replace(/spec release 0\.2\.0/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  for (const f of FIGURES) stripped = stripped.split(f).join(' ');
  stripped = stripped.replace(/(?<![\w.,])0(?![\w.,])/g, ' '); // the p = 0 row
  const stray = stripped.match(/[^\s]*\d[^\s]*/g) ?? [];
  assert.deepEqual(stray, [], `stray digits: ${stray.join(' | ')}`);
});

test('the Sprint 2 write-up is built and listed on the write-ups index', () => {
  const { out } = buildToTemp();
  assert.ok(existsSync(join(out, 'writeups', '2026-11-sprint-2', 'index.html')));
  const idx = readFileSync(join(out, 'writeups', 'index.html'), 'utf8');
  assert.match(idx, /2026-11-sprint-2\//);
  assert.match(idx, /Sprint 2: a validator that scores corruption/);
});

test('benchmarks.json: the two Sprint 2 slots carry their reproduce commands; a figure needs evidence; the laptop column is unmeasured', () => {
  const data = JSON.parse(readFileSync(join(root, 'data', 'benchmarks.json'), 'utf8'));
  const gs = data.rows.find((r) => /score versus noise/i.test(r.benchmark));
  assert.ok(gs, 'glyphsift score-versus-noise row missing');
  assert.equal(gs.repo, 'glyphsift');
  assert.equal(
    gs.command,
    'target/release/glyphsift bench --corpus bench/corpus/clean.txt --seeds 1,2,3 --csv docs/score-vs-noise.csv --svg docs/score-vs-noise.svg',
  );
  const rt = data.rows.find((r) => /WebGPU versus WASM/i.test(r.benchmark));
  assert.ok(rt, 'runtime WebGPU versus WASM row missing');
  assert.equal(rt.repo, 'runtime');
  assert.equal(rt.command, 'RUNTIME_MODEL=1 RUNTIME_REQUIRE_WEBGPU=1 npm run test:model');
  assert.match(rt.benchmark, /SmolLM2-135M/);
  for (const r of data.rows) {
    // The 8 GB Windows no-GPU laptop has not been measured: no figure may appear in that column.
    assert.equal(r.laptop, 'not measured on 8 GB', `${r.benchmark}: laptop`);
    if (r.dev !== 'not measured') {
      assert.match(r.evidence ?? '', /^(evidence\/sprint-\d\/|(pagetriage|glyphsift|localdata|runtime|dockit)\/docs\/benchmarks\/)/, `${r.benchmark}: a figure without evidence`);
      assert.ok(r.command, `${r.benchmark}: a figure without a command`);
    }
  }
});

test('every demos.json status line carries the Sprint 7 date and the keys and URLs are unchanged', () => {
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  assert.equal(demos.length, 6);
  for (const d of demos) {
    assert.deepEqual(Object.keys(d).sort(), ['repo', 'status', 'url', 'writtenOn'], `${d.repo}: keys`);
    assert.match(d.status, /^Sprint 7 \(20 Nov 2026\)[:.] /, `${d.repo}: Sprint 7 date`);
    assert.equal(d.writtenOn, '2026-11-20', `${d.repo}: writtenOn`);
  }
  assert.deepEqual(new Set(demos.map((d) => d.url)), new Set(DEMO_URLS));
});

test('the demos page not-yet box lists the four site limits and the page text derives its date from the data', () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'demos', 'index.html'), 'utf8');
  assert.match(html, /<li>No search\.<\/li>/);
  assert.match(html, /<li>No RSS feed\.<\/li>/);
  // Sprint 2 and 3 put figures on the benchmarks page, so 'every cell reads not measured' would be false.
  assert.match(html, /Most benchmarks are unmeasured/);
  assert.doesNotMatch(html, /every cell on the benchmarks page reads/);
  assert.match(html, /8 GB Windows no-GPU column reads "not measured on 8 GB" in\s+every\s+row/);
  assert.match(html, /hand-written and dated/);
  assert.doesNotMatch(html, /\{\{/, 'unreplaced placeholder');
});

test('no built page contains a script tag (Sprint 2 pages included)', () => {
  const { out } = buildToTemp();
  for (const file of walk(out).filter((f) => f.endsWith('.html'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /<script/i, `${file} has <script`);
  }
});

test('demos.json lines claim nothing the Sprint 3 gates (LANDED.json) do not mark green', () => {
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  const landed = readLanded();
  const green = (k) => isGreen(landed, k);
  for (const d of demos) {
    assert.doesNotMatch(d.status, /not in this status yet/, `${d.repo}: stale status`);
    assert.match(d.status, /^Sprint 7 \(20 Nov 2026\)[:.] /, `${d.repo}: prefix`);
    assert.doesNotMatch(d.status, /licensing|licence policy|policy page/i, `${d.repo}: must not advertise the licensing draft`);
    // A claim sentence is anything before 'Not yet'; the Not yet tail may name what is missing.
    const claimed = d.status.split(/Not yet/)[0];
    // WebLLM did not land in Sprint 3: it is never claimed. Without a LANDED.json this is still the rule.
    if (!green('webllm')) assert.doesNotMatch(claimed, /WebLLM/, `${d.repo}: WebLLM claim without green`);
    if (!green('worker')) assert.doesNotMatch(claimed, /engine runs in a worker|in a worker/i, `${d.repo}: worker claim without green`);
    if (!green('trustedTypes')) assert.doesNotMatch(claimed, /Trusted Types/, `${d.repo}: Trusted Types claim without green`);
  }
  const by = Object.fromEntries(demos.map((d) => [d.repo, d.status]));
  assert.match(by.dockit, /Qwen3-0\.6B/);
  assert.match(by.dockit, /not measured on 8 GB/);
  assert.match(by.runtime, /Tamper lab/);
  if (by.glyphsift.startsWith('Sprint 3')) assert.match(by.glyphsift, /sixteen/);
  assert.match(by.site, /No scripts/);
});

// Lines rewritten in the Sprint 3 fix round from T1's observations (T1 demos/*.json, worker.json,
// devtools-figures-t1.json) and LANDED.json: worker, Trusted Types and the DevTools transport are green,
// WebLLM is not landed.
test('demos.json runtime line states what T1 observed and keeps WebLLM, 8 GB and the Stop button as not yet', () => {
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  const rt = demos.find((d) => d.repo === 'runtime').status;
  const [claimed, notYet] = rt.split(/Not yet: /);
  assert.ok(notYet, 'runtime line has a Not yet tail');
  if (!rt.startsWith('Sprint 3')) {
    // The product owner rewrote this line at close-out (Sprint 4): the Sprint 3 pins below no longer apply, the generic rules do.
    assert.doesNotMatch(claimed, /WebLLM/);
    assert.match(notYet, /WebLLM (\(cut\)|\(cut from Sprint 4\)|not yet \(cut from Sprint 4\))/);
    return;
  }
  assert.doesNotMatch(rt, /page freezes/i, 'the freeze was a Sprint 2 limit; the worker fixed it');
  assert.doesNotMatch(rt, /Force WASM/, 'the picker replaced the Force WASM box');
  assert.match(claimed, /Engine picker \(Auto, WebGPU, WebAssembly\)/);
  assert.match(claimed, /engine runs in a worker/);
  assert.match(claimed, /page stays responsive during a WebAssembly answer/);
  assert.match(claimed, /load-timing and memory read-out/);
  assert.match(claimed, /DevTools panel is loadable unpacked/);
  assert.match(claimed, /Trusted Types on/);
  assert.match(claimed, /only after you click/);
  assert.match(claimed, /not the Hindi production model/);
  assert.doesNotMatch(claimed, /WebLLM/);
  assert.match(notYet, /^WebLLM \(carried to Sprint 4\), Windows and 8 GB no-GPU measurements, no Stop button\.$/);
});

test('demos.json glyphsift line states the drop zone, heatmap and refusals T1 observed and drops the stale heatmap not-yet', () => {
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  const gs = demos.find((d) => d.repo === 'glyphsift').status;
  const [claimed, notYet] = gs.split(/Not yet: /);
  assert.ok(notYet, 'glyphsift line has a Not yet tail');
  if (!gs.startsWith('Sprint 3')) return; // rewritten by the product owner at close-out (Sprint 4); the generic rules apply
  assert.match(claimed, /paste, drop or choose a UTF-8 \.txt file up to 1 MiB/);
  assert.match(claimed, /per-line strip/);
  assert.match(claimed, /per-cluster heatmap/);
  assert.match(claimed, /sixteen rules/);
  assert.match(claimed, /refus/i);
  assert.match(claimed, /computed in WebAssembly in the tab, with 0 requests/);
  // The heatmap landed (T1: highlighted clusters equal the report's distinct clusters for all five samples).
  assert.doesNotMatch(gs, /per-line heatmap/);
  assert.match(notYet, /scripts other than Devanagari/);
  assert.match(notYet, /published package or wheel/);
});

test('pagetriage and localdata lines no longer carry the Sprint 3 wording (the demos now carry their own sprint status text)', () => {
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  for (const repo of ['pagetriage', 'localdata']) {
    const line = demos.find((d) => d.repo === repo).status;
    assert.doesNotMatch(line, /status line/, `${repo}: stale 'status line'`);
    assert.match(line, /^Sprint 7 \(20 Nov 2026\)[:.] /, `${repo}: Sprint 7 line`);
  }
});

// BUG-T1-S5-04: the same convention as dockit: 'Built from main at <sha12>' in CI, 'Local build <sha12>[-dirty]' from git HEAD locally, and a
// documented fallback ('Local build unknown') for a lone checkout that has no .git.
//
// These tests must give the same answer on a laptop and on a GitHub Actions runner, where GITHUB_ACTIONS, CI, GITHUB_SHA, GITHUB_REF and
// GITHUB_REF_NAME are all set (and GITHUB_REF is refs/pull/<n>/merge on a pull request, refs/heads/main on a push to main). So none of them
// reads the ambient environment by accident: a call either passes `env` (`{}` is "not in CI") or runs inside withEnv(), which clears every CI
// variable, sets only the ones the test names, and restores the originals afterwards. The one test that calls buildId() with the real
// environment says so and accepts both well-formed shapes.
const SHA40 = 'abcdef0123456789abcdef0123456789abcdef01';
const gitStub = (answers) => (_root, args) => {
  const key = args.join(' ');
  if (!(key in answers)) throw new Error(`git ${key}: not a repository`);
  return answers[key];
};
const TOP = '/work/site';
const LOCAL_SHAPE = /^Local build (?:[0-9a-f]{12}(?:-dirty)?|unknown)$/;
const CI_SHAPE = /^Built from main at [0-9a-f]{12}$/;
const CI_ENV_VARS = ['GITHUB_ACTIONS', 'CI', 'GITHUB_SHA', 'GITHUB_REF', 'GITHUB_REF_NAME'];
/** What a push to main on GitHub Actions sets (the subset build.mjs and these tests care about). */
const ciMain = (sha = SHA40) => ({ GITHUB_ACTIONS: 'true', CI: 'true', GITHUB_SHA: sha, GITHUB_REF_NAME: 'main', GITHUB_REF: 'refs/heads/main' });
/** What a pull_request run sets: same SHA variable, but the ref is the merge ref. */
const ciPullRequest = (sha = SHA40) => ({ GITHUB_ACTIONS: 'true', CI: 'true', GITHUB_SHA: sha, GITHUB_REF_NAME: '7/merge', GITHUB_REF: 'refs/pull/7/merge' });

/** Run fn with every CI variable removed from process.env except those in `vars`; always restore the originals. */
function withEnv(vars, fn) {
  const prev = Object.fromEntries(CI_ENV_VARS.map((k) => [k, process.env[k]]));
  try {
    for (const k of CI_ENV_VARS) delete process.env[k];
    for (const [k, v] of Object.entries(vars)) process.env[k] = v;
    return fn();
  } finally {
    for (const k of CI_ENV_VARS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test('withEnv clears every CI variable, sets only the named ones and restores the originals', () => {
  const before = Object.fromEntries(CI_ENV_VARS.map((k) => [k, process.env[k]]));
  withEnv(ciMain(), () => {
    assert.equal(process.env.GITHUB_SHA, SHA40);
    withEnv({}, () => {
      for (const k of CI_ENV_VARS) assert.equal(process.env[k], undefined, k);
    });
    assert.equal(process.env.GITHUB_SHA, SHA40, 'the inner call restored the outer environment');
    withEnv({ GITHUB_SHA: SHA40 }, () => {
      assert.equal(process.env.GITHUB_REF, undefined, 'a variable the test did not name is not inherited from the runner');
    });
  });
  assert.throws(() => withEnv(ciMain(), () => { throw new Error('boom'); }), /boom/);
  for (const k of CI_ENV_VARS) assert.equal(process.env[k], before[k], `${k} restored`);
});

test('buildId: a 40-hex GITHUB_SHA reads Built from main at <sha12>; anything else is not CI', () => {
  assert.equal(buildId({ env: { GITHUB_SHA: SHA40 }, root: TOP, git: gitStub({}) }), 'Built from main at abcdef012345');
  for (const bad of ['', 'abc123', SHA40.toUpperCase(), `${SHA40}0`, `<script>alert(1)</script>${'a'.repeat(20)}`]) {
    assert.equal(buildId({ env: { GITHUB_SHA: bad }, root: TOP, git: gitStub({}) }), 'Local build unknown', JSON.stringify(bad));
  }
});

// The CI branch, asserted on its own: the environment a GitHub Actions push to main really sets. git is not consulted at all (the stub throws
// and counts), so the answer cannot come from the runner's checkout, and it is the same whether or not the tree is dirty.
test('buildId: with the GitHub Actions push-to-main environment the CI branch answers and git is never asked', () => {
  let asked = 0;
  const git = () => {
    asked += 1;
    throw new Error('git must not be consulted in CI');
  };
  assert.equal(buildId({ env: ciMain(), root: TOP, git }), 'Built from main at abcdef012345');
  assert.equal(buildId({ env: ciMain('c0ffee0123456789c0ffee0123456789c0ffee01'), root: TOP, git }), 'Built from main at c0ffee012345');
  assert.equal(asked, 0);
  // CI=true and GITHUB_ACTIONS=true alone (no usable SHA) is not enough for 'Built from main'
  assert.equal(buildId({ env: { GITHUB_ACTIONS: 'true', CI: 'true', GITHUB_REF: 'refs/heads/main' }, root: TOP, git: gitStub({}) }), 'Local build unknown');
});

test('buildId: with the pull_request environment (GITHUB_REF=refs/pull/<n>/merge) it is a local-form id, never "Built from main"', () => {
  const head = '0123456789abcdef0123456789abcdef01234567';
  const git = gitStub({ 'rev-parse --show-toplevel': TOP, 'rev-parse HEAD': head, 'status --porcelain --untracked-files=no': '' });
  assert.equal(buildId({ env: ciPullRequest(), root: TOP, git }), 'Local build 0123456789ab');
  assert.equal(buildId({ env: ciPullRequest(), root: TOP, git: gitStub({}) }), 'Local build unknown');
});

// BUG-T1-S5-R2-04: the same rule as runtime demo/build-id.ts buildLabel(): 'Built from main' needs a 40-hex GITHUB_SHA AND GITHUB_REF of
// refs/heads/main (or no GITHUB_REF at all). A workflow_dispatch run of pages.yml on another ref must not say 'main'.
test('buildId: GITHUB_REF other than refs/heads/main is not "Built from main" (falls back to the git HEAD form or Local build unknown)', () => {
  const head = '0123456789abcdef0123456789abcdef01234567';
  const git = gitStub({ 'rev-parse --show-toplevel': TOP, 'rev-parse HEAD': head, 'status --porcelain --untracked-files=no': '' });
  for (const ref of ['refs/heads/feature', 'refs/tags/v1', 'refs/pull/7/merge', 'main', 'refs/heads/main2', ' refs/heads/main']) {
    const env = { GITHUB_SHA: SHA40, GITHUB_REF: ref };
    assert.equal(buildId({ env, root: TOP, git }), 'Local build 0123456789ab', ref);
    assert.equal(buildId({ env, root: TOP, git: gitStub({}) }), 'Local build unknown', `${ref} (no git)`);
  }
});

test('buildId: GITHUB_REF of refs/heads/main, empty or unset still reads Built from main at <sha12>', () => {
  for (const ref of ['refs/heads/main', '', undefined]) {
    const env = ref === undefined ? { GITHUB_SHA: SHA40 } : { GITHUB_SHA: SHA40, GITHUB_REF: ref };
    assert.equal(buildId({ env, root: TOP, git: gitStub({}) }), 'Built from main at abcdef012345', String(ref));
  }
});

test('buildId: with no env passed it reads process.env (GITHUB_SHA and GITHUB_REF)', () => {
  const answer = (vars) => withEnv(vars, () => buildId({ root: TOP, git: gitStub({}) }));
  assert.equal(answer({ GITHUB_SHA: SHA40, GITHUB_REF: 'refs/heads/feature' }), 'Local build unknown');
  assert.equal(answer({ GITHUB_SHA: SHA40, GITHUB_REF: 'refs/heads/main' }), 'Built from main at abcdef012345');
  assert.equal(answer({ GITHUB_SHA: SHA40 }), 'Built from main at abcdef012345');
  assert.equal(answer({}), 'Local build unknown');
});

test('every page footer says Local build, not Built from main, when GITHUB_REF is another ref', () => {
  for (const vars of [{ GITHUB_SHA: SHA40, GITHUB_REF: 'refs/heads/feature' }, ciPullRequest()]) {
    withEnv(vars, () => {
      const { out } = buildToTemp();
      for (const file of walk(out).filter((f) => f.endsWith('.html'))) {
        const html = readFileSync(file, 'utf8');
        assert.doesNotMatch(html, /Built from main/, file);
        assert.match(html, /Local build (?:[0-9a-f]{12}(?:-dirty)?|unknown)/, file);
      }
    });
  }
});

test('buildId: locally it reads git HEAD, with -dirty when a tracked file differs, and unknown when git cannot say', () => {
  const head = '0123456789abcdef0123456789abcdef01234567';
  const base = { 'rev-parse --show-toplevel': TOP, 'rev-parse HEAD': head };
  assert.equal(
    buildId({ env: {}, root: TOP, git: gitStub({ ...base, 'status --porcelain --untracked-files=no': '' }) }),
    'Local build 0123456789ab',
  );
  assert.equal(
    buildId({ env: {}, root: TOP, git: gitStub({ ...base, 'status --porcelain --untracked-files=no': ' M scripts/build.mjs' }) }),
    'Local build 0123456789ab-dirty',
  );
  // no .git (a lone checkout): the documented fallback, never an error
  assert.equal(buildId({ env: {}, root: TOP, git: gitStub({}) }), 'Local build unknown');
});

test('buildId: a copy of the site inside ANOTHER repository does not borrow that repository\'s HEAD', () => {
  const answers = {
    'rev-parse --show-toplevel': '/srv/work/other-repo',
    'rev-parse HEAD': '1111111111111111111111111111111111111111',
    'status --porcelain --untracked-files=no': '',
  };
  assert.equal(buildId({ env: {}, root: '/srv/work/other-repo/lone/site', git: gitStub(answers) }), 'Local build unknown');
});

test('buildId: the real git call with no CI environment (git in this folder, or none in a lone checkout) gives a well-formed local id', () => {
  assert.match(buildId({ env: {}, root }), LOCAL_SHAPE);
});

// This one deliberately uses the REAL process environment, so it accepts both well-formed shapes: the CI shape on a GitHub Actions push to
// main (or whenever GITHUB_SHA is a 40-hex SHA and GITHUB_REF is main or unset) and the local shape everywhere else, and it cross-checks which.
test('buildId: the real call with the real environment gives a well-formed id of either shape, consistent with that environment', () => {
  const id = buildId({ root });
  assert.match(id, /^(?:Built from main at [0-9a-f]{12}|Local build (?:[0-9a-f]{12}(?:-dirty)?|unknown))$/);
  const { GITHUB_SHA: sha, GITHUB_REF: ref } = process.env;
  const ci = typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha) && (ref === undefined || ref === '' || ref === 'refs/heads/main');
  if (ci) {
    assert.match(id, CI_SHAPE);
    assert.equal(id, `Built from main at ${sha.slice(0, 12)}`);
  } else {
    assert.match(id, LOCAL_SHAPE);
  }
});

test('every page footer shows the build id: Built from main at <sha12> in CI, else Local build <sha12>[-dirty] or Local build unknown', () => {
  const cases = [
    [undefined, /Local build (?:[0-9a-f]{12}(?:-dirty)?|unknown)/],
    ['', /Local build (?:[0-9a-f]{12}(?:-dirty)?|unknown)/],
    ['abc123', /Local build (?:[0-9a-f]{12}(?:-dirty)?|unknown)/],
    [SHA40.toUpperCase(), /Local build (?:[0-9a-f]{12}(?:-dirty)?|unknown)/],
    [`${SHA40}0`, /Local build (?:[0-9a-f]{12}(?:-dirty)?|unknown)/],
    [`<script>alert(1)</script>${'a'.repeat(20)}`, /Local build (?:[0-9a-f]{12}(?:-dirty)?|unknown)/],
    [SHA40, /Built from main at abcdef012345\b/],
  ];
  for (const [val, want] of cases) {
    // GITHUB_REF is cleared too (withEnv), so a runner on refs/pull/<n>/merge cannot turn the SHA40 case into a local-form footer
    withEnv(val === undefined ? {} : { GITHUB_SHA: val }, () => {
      const { out } = buildToTemp();
      for (const file of walk(out).filter((f) => f.endsWith('.html'))) {
        const html = readFileSync(file, 'utf8');
        const m = /No scripts, no tracking, no cookies\. ([^<]*?)\.\s*<\/p>/.exec(html);
        assert.ok(m, `${file}: footer line`);
        assert.match(m[1], want, `${file} (${val}): build id`);
        assert.match(m[1], /\d{4}-\d{2}-\d{2}/, `${file}: the build date stays`);
        assert.doesNotMatch(html, /<script/i);
        assert.doesNotMatch(m[1], /· build |^Built \d/, `${file}: the old '<date> · build <id>' form is gone`);
      }
    });
  }
});

test('every page footer reads Built from main at <sha12> under the full GitHub Actions push-to-main environment', () => {
  withEnv(ciMain('c0ffee0123456789c0ffee0123456789c0ffee01'), () => {
    const { out } = buildToTemp();
    const pages = walk(out).filter((f) => f.endsWith('.html'));
    assert.ok(pages.length >= 5);
    for (const file of pages) {
      const html = readFileSync(file, 'utf8');
      assert.match(html, /No scripts, no tracking, no cookies\. Built from main at c0ffee012345 · \d{4}-\d{2}-\d{2}\.\s*<\/p>/, file);
      assert.doesNotMatch(html, /Local build/, file);
    }
  });
});

test('the README documents the build id convention and the no-.git fallback', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(readme, /Built from main at <sha12>/);
  assert.match(readme, /Local build <sha12>\[-dirty\]/);
  assert.match(readme, /Local build unknown/);
});

// ---- Sprint 3: draft pages (licensing policy, write-up skeleton), benchmark slots ----

const LICENCE_REPOS = ['pagetriage', 'glyphsift', 'localdata', 'runtime', 'dockit', 'site', 'control-plane'];

function draftFixture(extra = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'amlabs-site-draft-'));
  cpSync(join(root, 'src'), join(tmp, 'src'), { recursive: true });
  cpSync(join(root, 'data'), join(tmp, 'data'), { recursive: true });
  mkdirSync(join(tmp, 'writeups'));
  for (const [rel, text] of Object.entries(extra)) writeFileSync(join(tmp, rel), text);
  return tmp;
}

test('a fragment with the draft meta gets a robots noindex, is not listed and is not linked', () => {
  const tmp = draftFixture({
    'writeups/2026-11-secret.html': '<!-- title: Secret draft -->\n<!-- date: 2026-11-30 -->\n<meta name="draft" content="true" />\n<h1>Secret draft</h1>',
    'writeups/2026-11-public.html': '<!-- title: Public one -->\n<!-- date: 2026-11-29 -->\n<h1>Public one</h1>',
  });
  const out = join(tmp, 'dist');
  build({ root: tmp, outDir: out });
  const draft = readFileSync(join(out, 'writeups', '2026-11-secret', 'index.html'), 'utf8');
  assert.match(draft, /<meta name="robots" content="noindex" \/>/);
  assert.doesNotMatch(draft, /<meta name="draft"/, 'the draft marker is consumed, not emitted');
  const pub = readFileSync(join(out, 'writeups', '2026-11-public', 'index.html'), 'utf8');
  assert.doesNotMatch(pub, /robots/i, 'non-draft pages stay indexable');
  const idx = readFileSync(join(out, 'writeups', 'index.html'), 'utf8');
  assert.match(idx, /Public one/);
  assert.doesNotMatch(idx, /Secret draft|2026-11-secret/);
});

test('licences.json lists the seven repos and equals each repository LICENSE head (committed fixtures)', () => {
  const data = JSON.parse(readFileSync(join(root, 'data', 'licences.json'), 'utf8'));
  assert.deepEqual(data.repos.map((r) => r.repo), LICENCE_REPOS);
  const byRepo = Object.fromEntries(data.repos.map((r) => [r.repo, r]));
  assert.equal(byRepo.pagetriage.licence, 'MIT OR Apache-2.0');
  for (const r of ['glyphsift', 'localdata', 'runtime', 'dockit', 'site']) assert.equal(byRepo[r].licence, 'Apache-2.0');
  assert.match(byRepo['control-plane'].licence, /^Functional Source License, Version 1\.1, Apache 2\.0 Future License \(FSL-1\.1-Apache-2\.0; SPDX FSL-1\.1-ALv2\)$/);
  assert.equal(byRepo['control-plane'].visibility, 'private');
  // Read against each repository's LICENSE head, taken from the committed fixtures (npm run test:siblings re-reads the live files).
  const read = (repo, path) => (repo === 'site' ? readFileSync(join(root, path), 'utf8') : readSibling(repo, path));
  for (const repo of LICENCE_REPOS) {
    if (repo === 'pagetriage') {
      assert.match(read(repo, 'LICENSE-APACHE'), /Apache License\s+Version 2\.0/);
      assert.match(read(repo, 'LICENSE-MIT'), /^MIT License/);
    } else if (repo === 'control-plane') {
      const t = read(repo, 'LICENSE');
      assert.match(t, /^Functional Source License, Version 1\.1, Apache 2\.0 Future License/);
      assert.match(t, /FSL-1\.1-Apache-2\.0/);
    } else {
      assert.match(read(repo, 'LICENSE'), /Apache License\s+Version 2\.0/, `${repo}: LICENSE is not Apache-2.0`);
    }
  }
});

test('the licensing page is a built, unlinked, noindex draft with the plan commitments only', () => {
  const { out } = buildToTemp();
  const file = join(out, 'licensing', 'index.html');
  assert.ok(existsSync(file), 'licensing/index.html missing');
  const html = readFileSync(file, 'utf8');
  const flat = html.replace(/\s+/g, ' ');
  assert.match(flat, /Draft for owner review\. Not yet published as policy\./);
  assert.match(html, /<meta name="robots" content="noindex" \/>/);
  assert.doesNotMatch(html, /<script/i);
  assert.match(flat, /never relicense/i);
  assert.match(flat, /\[owner to confirm\]/);
  assert.match(flat, /Questions: see SECURITY\.md contact/);
  const data = JSON.parse(readFileSync(join(root, 'data', 'licences.json'), 'utf8'));
  for (const r of data.repos) {
    assert.ok(html.includes(`data-repo="${r.repo}"`), `${r.repo}: row missing`);
    assert.ok(flat.includes(r.licence.replace(/&/g, '&amp;')), `${r.repo}: licence text missing`);
  }
  // AGPL only appears in the 'no AGPL' sentence.
  const agpl = flat.match(/[^.]*AGPL[^.]*\./g) ?? [];
  assert.ok(agpl.length >= 1, 'the no-AGPL sentence is missing');
  for (const sentence of agpl) assert.match(sentence, /no AGPL|never AGPL|not AGPL/i, `AGPL outside the no-AGPL sentence: ${sentence}`);
  // 'open source' is never applied to control-plane.
  const cpRow = /<tr[^>]*data-repo="control-plane"[\s\S]*?<\/tr>/.exec(html)?.[0] ?? '';
  assert.ok(cpRow.length > 0);
  assert.doesNotMatch(cpRow.replace(/not open source/gi, ''), /open[- ]source/i);
  assert.match(cpRow, /not open source by the OSI definition/);
  assert.match(cpRow, /two years/);
});

test('no built page links to the licensing draft: nav, footer, index, write-ups list or anywhere', () => {
  const { out } = buildToTemp();
  for (const file of walk(out).filter((f) => f.endsWith('.html'))) {
    if (file === join(out, 'licensing', 'index.html')) continue;
    const html = readFileSync(file, 'utf8');
    assert.doesNotMatch(html, /href="[^"]*licensing\/?"/i, `${file} links to the licensing draft`);
    assert.doesNotMatch(html, /Draft for owner review/, `${file} carries draft text`);
  }
});

// ---- Sprint 4 (D5-04, droppable first): the Sprint 3 write-up is finished from evidence/sprint-3 only; the Sprint 4 write-up is a skeleton ----

// A missing file reads as empty, so the tests below fail with their own message instead of killing the run.
const readOrEmpty = (rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : '');
const SPRINT3_WRITEUP = readOrEmpty('writeups/2026-11-sprint-3.html');
const SPRINT4_WRITEUP = readOrEmpty('writeups/2026-11-sprint-4.html');
const ALLOWED_NUMBER_TOKENS = [
  /\bSprints? [1-7]\b/g,
  /\b\d{1,2} (to \d{1,2} )?(November|December|Nov) 2026\b/g,
  /\b\d{1,2} January 2027\b/g,
  /\b8 GB\b/g,
  /\bM5 Pro 48 GB\b/g,
  /\bM5 Pro\b/g,
  /\brunbook step 5\b/g,
  /\bmanifest spec v0\.1\b/g,
  /CC BY 4\.0/g,
  /\b(TD|S1)-\d{2,3}\b/g,
  /\bQwen3-0\.6B\b/g,
];

function figureElements(html) {
  const body = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<meta[^>]*>/g, ' ');
  return [...body.matchAll(/<(li|p)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}
const hasStrayNumber = (text) => {
  let t = text.replace(/evidence\/sprint-\d\/\S*/g, ' ');
  for (const re of ALLOWED_NUMBER_TOKENS) t = t.replace(re, ' ');
  return /\d/.test(t);
};

test('Sprint 3 write-up: finished, unlisted and noindex, states it is committed and not pushed, no skeleton text left', () => {
  assert.match(SPRINT3_WRITEUP, /<meta name="draft" content="true"/);
  for (const h of ['What we tried', 'What held up', 'What did not', 'Numbers', 'Limitations']) {
    assert.match(SPRINT3_WRITEUP, new RegExp(`<h2>${h}`), `section ${h} missing`);
  }
  const flat = SPRINT3_WRITEUP.replace(/\s+/g, ' ');
  assert.ok(flat.includes('Committed on 14 Nov 2026, not pushed; the live demos show Sprint 2 until the owner pushes'), 'the committed-not-pushed sentence is missing');
  assert.doesNotMatch(flat, /To be filled|to be filled|skeleton|product owner to finish|data-slot/i);
  assert.doesNotMatch(SPRINT3_WRITEUP, /<script|\sstyle="|https?:\/\//i);
  assert.doesNotMatch(SPRINT3_WRITEUP, /\/private\/tmp/, 'no scratch path: cite evidence/sprint-3/');
  assert.match(flat, /tests-first evidence Done \(red\/green logs\); local macOS green; CI on three OSes configured, pending the owner's push/);
  assert.match(flat, /not measured on 8 GB/);
  const { out } = buildToTemp();
  const built = readFileSync(join(out, 'writeups', '2026-11-sprint-3', 'index.html'), 'utf8');
  assert.match(built, /<meta name="robots" content="noindex" \/>/);
  const idx = readFileSync(join(out, 'writeups', 'index.html'), 'utf8');
  assert.doesNotMatch(idx, /2026-11-sprint-3|Sprint 3/);
});

test('Sprint 3 write-up: every element with a figure carries an evidence/sprint-3 path, and every cited path exists', () => {
  const bad = figureElements(SPRINT3_WRITEUP).filter((t) => hasStrayNumber(t) && !/evidence\/sprint-3\//.test(t));
  assert.deepEqual(bad, [], `figures without an evidence path: ${bad.join(' || ')}`);
  const cited = [...new Set([...SPRINT3_WRITEUP.matchAll(/evidence\/sprint-3\/([A-Za-z0-9_./-]+[A-Za-z0-9_])/g)].map((m) => m[1]))];
  assert.ok(cited.length >= 15, `expected at least 15 distinct evidence paths, found ${cited.length}`);
  for (const rel of cited) assert.ok(evidenceExists(`sprint-3/${rel}`), `evidence/sprint-3/${rel} is not in the recorded evidence index`);
});

test('Sprint 3 write-up: each figure equals the saved evidence it cites', () => {
  const flat = SPRINT3_WRITEUP.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const read = (rel) => readSibling('evidence', `sprint-3/${rel}`);
  const sumRust = (rel) => [...read(rel).matchAll(/^test result: \w+\. (\d+) passed; (\d+) failed/gm)].reduce((a, m) => [a[0] + Number(m[1]), a[1] + Number(m[2])], [0, 0]);
  const must = (text, why) => assert.ok(flat.includes(text), `missing '${text}' (${why})`);
  // Tests
  assert.match(read('T1/r3/runtime-ci.log'), /Tests\s+955 passed \(955\)/);
  must('955 unit tests', 'runtime-ci.log');
  for (const [rel, n] of [['runtime-test-browser.log', 12], ['runtime-test-model.log', 9], ['runtime-test-worker.log', 8], ['runtime-test-devtools.log', 2], ['localdata-test-browser.log', 11], ['dockit-test-browser.log', 21]]) {
    assert.match(read(`T1/r3/${rel}`), new RegExp(`\\b${n} passed\\b`), rel);
  }
  assert.match(read('T1/r3/localdata-ci.log'), /Tests\s+144 passed \| 13 skipped \(157\)/);
  assert.match(read('T1/r3/dockit-ci-noenv.log'), /Tests\s+103 passed \(103\)/);
  assert.match(read('T1/r3/site-build-test.log'), /# tests 40\n[\s\S]*# pass 40\n# fail 0/);
  for (const t of ['12 passed', '9 passed', '8 passed', '2 passed', '11 passed', '21 passed', '144 passed and 13 skipped', '103 unit tests', '40 of 40']) must(t, 'test counts');
  const gs = sumRust('T2/r2/cargo-test-glyphsift.full.log');
  const pt = sumRust('T2/r2/cargo-test-pagetriage.full.log');
  const cp = sumRust('T2/r2/cargo-test-control-plane.full.log');
  assert.deepEqual([gs, pt, cp].map((x) => x[1]), [0, 0, 0]);
  must(`glyphsift ${gs[0]}, pagetriage ${pt[0]} and control-plane ${cp[0]} Rust tests passed, 0 failed`, 'cargo test sums');
  // Worker responsiveness and abort (T1/r3/worker.json)
  const w = JSON.parse(read('T1/r3/worker.json'));
  const fmt = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });
  const workerGaps = new Set(w.longTask.worker.map((r) => r.longestRafGapInWindowMs));
  assert.equal(workerGaps.size, 1, 'the three worker runs share one gap figure');
  const mainGaps = w.longTask.main.map((r) => r.longestRafGapInWindowMs);
  must(`${fmt([...workerGaps][0])} ms`, 'worker rAF gap');
  must(`between ${fmt(Math.min(...mainGaps))} and ${fmt(Math.max(...mainGaps))} ms`, 'main rAF gaps');
  assert.ok(w.longTask.worker.every((r) => r.completionTokens === 32) && w.longTask.worker.length === 3);
  const aborts = w.abort.runs;
  assert.ok(aborts.length === 5 && aborts.every((r) => r.ok && r.finishReason === 'abort'));
  must(`5 of 5 aborts`, 'abort count');
  must(`${fmt(Math.min(...aborts.map((r) => r.latencyMs)))} to ${fmt(Math.max(...aborts.map((r) => r.latencyMs)))} ms`, 'abort latency');
  assert.equal(w.abort.next.bytesDownloaded, 0);
  assert.equal(w.egressProbes.egressRefusedEventCount, 12);
  assert.equal(w.egressProbes.stagingPrefixRequests, 0);
  must('12 egress-refused events', 'egress count');
  assert.equal(w.demoHasStopButton, false);
  // Artifacts
  const hashes = read('T1/r3/artifact-hashes.log');
  assert.match(hashes, /sizes: wheel 245869, tgz 111710/);
  assert.match(hashes, /1685837/);
  assert.match(hashes, /988441/);
  for (const t of ['245,869 B', '111,710 B', '1,685,837 B', '988,441 B']) must(t, 'artifact sizes');
  assert.equal(read('D1/SPEC-LANDED.txt').trim().split('\n').length, 71);
  must('71 sha256 values', 'SPEC-LANDED.txt');
  // DevTools panel figures (same files as the benchmarks page)
  for (const rel of ['D1/devtools/devtools-figures.json', 'T1/r3/devtools/devtools-figures-t1.json']) {
    const j = JSON.parse(read(rel));
    for (const phase of ['acquire', 'verify', 'handoff', 'session', 'first_token']) must(fmtMs(j.panelPhaseDurationsMs[phase]), `${rel} ${phase}`);
    const after = j.panelMemory.find((m) => m.at === 'after_session' && m.api === 'performance.memory');
    must(after.used, `${rel} after_session heap`);
  }
  // LANDED.json: webllm not landed
  assert.equal(JSON.parse(read('D1/LANDED.json')).webllm.status, 'not landed');
  assert.match(read('S1/rv2/rv2-findings-append.md'), /glyphsift v0\.1\.0 tag NO-GO/);
});

// ---- Sprint 6 (D5-09): the Sprint 4 and Sprint 5 write-ups are finished from their saved evidence and reports; every figure is recomputed here ----

const SPRINT5_WRITEUP = readOrEmpty('writeups/2026-11-sprint-5.html');
const SPRINT6_WRITEUP = readOrEmpty('writeups/2026-11-sprint-6.html');
const SPRINT7_WRITEUP = readOrEmpty('writeups/2026-11-sprint-7.html');
const FIVE_HEADINGS = ['What we tried', 'What held up', 'What did not', 'Numbers (Apple M5 Pro; not measured on 8 GB)', 'Limitations'];
/** What a figure may cite: an evidence file, the localdata benchmark CSV, or a sprint report. */
const CITE = /evidence\/sprint-\d\/[A-Za-z0-9_./-]*[A-Za-z0-9_]|localdata\/docs\/benchmarks\/vector-index\.csv|dockit\/docs\/benchmarks\/e2e(?:-questions)?(?:-s6-baseline)?\.csv|SPRINT-\d-REPORT\.md/;
const flatText = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

function assertFinishedWriteup(html, n) {
  assert.match(html, /<meta name="draft" content="true"/, 'unlisted and noindex until the owner publishes it');
  const heads = [...html.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(heads, FIVE_HEADINGS);
  assert.doesNotMatch(html, /\[product owner|data-slot|skeleton|to be filled/i, 'no skeleton text left');
  assert.doesNotMatch(html, /\/private\/tmp|<script|\sstyle="|https?:\/\//i);
  // every element that carries a figure names the file it was read from
  const bad = figureElements(html).filter((t) => hasStrayNumber(t) && !CITE.test(t));
  assert.deepEqual(bad, [], `figures without a cited file: ${bad.join(' || ')}`);
  // every evidence path it cites is in the recorded index, and the localdata CSV and the reports are committed fixtures
  const evidence = [...new Set([...html.matchAll(/evidence\/(sprint-\d\/[A-Za-z0-9_./-]*[A-Za-z0-9_])/g)].map((m) => m[1]))];
  assert.ok(evidence.length >= 2, `expected at least 2 distinct evidence paths, found ${evidence.length}`);
  for (const rel of evidence) {
    assert.ok(rel.startsWith(`sprint-${n}/`), `${rel}: a Sprint ${n} write-up cites Sprint ${n} evidence only`);
    assert.ok(evidenceExists(rel), `evidence/${rel} is not in the recorded evidence index`);
  }
  if (/localdata\/docs\/benchmarks\/vector-index\.csv/.test(html)) readSibling('localdata', 'docs/benchmarks/vector-index.csv');
  if (new RegExp(`SPRINT-${n}-REPORT\\.md`).test(html)) readSibling('workspace', `SPRINT-${n}-REPORT.md`);
  for (const csv of new Set(html.match(/dockit\/docs\/benchmarks\/e2e(?:-questions)?(?:-s6-baseline)?\.csv/g) ?? [])) readSibling('dockit', csv.slice('dockit/'.length));
  const flat = flatText(html).replace(/\s+/g, ' ');
  assert.match(flat, /not measured on 8 GB/);
  assert.doesNotMatch(flat, /cheaper inference|save on inference|lower inference cost|cost per token|compliance export|DPDP\/GDPR-ready/i);
  // built: noindex, and not in the write-ups list
  const { out } = buildToTemp();
  const built = readFileSync(join(out, 'writeups', `2026-11-sprint-${n}`, 'index.html'), 'utf8');
  assert.match(built, /<meta name="robots" content="noindex" \/>/);
  assert.doesNotMatch(readFileSync(join(out, 'writeups', 'index.html'), 'utf8'), new RegExp(`2026-11-sprint-${n}|Sprint ${n}`));
  return flat;
}

test('Sprint 4 write-up: finished, unlisted and noindex, five headings, every figure cites its file, no scratch path', () => {
  const flat = assertFinishedWriteup(SPRINT4_WRITEUP, 4);
  assert.match(flat, /Sprint 4 \(planned 21 December 2026 to 3 January 2027/);
  assert.match(flat, /manifest spec v0\.1 published in runtime\/spec as spec release 0\.4\.0/);
  assert.doesNotMatch(flat, /public after the owner's push/, 'the sprint was pushed on 15 November 2026: the old wording is out of date');
  assert.match(flat, /WebLLM engine rung\. It was cut, not half-landed/);
});

test('Sprint 4 write-up: each figure equals the file it cites (the localdata benchmark CSV, SPEC-LANDED.txt, the demo test log and the report)', () => {
  const flat = flatText(SPRINT4_WRITEUP);
  const must = (t, why) => assert.ok(flat.includes(t), `missing '${t}' (${why})`);
  const csv = readSibling('localdata', 'docs/benchmarks/vector-index.csv').trim().split('\n');
  const cols = csv[0].split(',');
  const rows = csv.slice(1).map((l) => {
    const cells = (l.match(/("[^"]*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, ''));
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
  });
  const cold = (chunk, restart) =>
    rows.filter((r) => r.rows === '100000' && r.dim === '384' && r.chunk_bytes === String(chunk) && r.restart === restart && r.driver === 'opfs');
  const med = (v) => [...v].sort((a, b) => a - b)[v.length >> 1];
  const fmt = (n) => `${n.toFixed(1)} ms`;
  for (const chunk of [256, 2048]) {
    const one = cold(chunk, 'false');
    assert.equal(one.length, 5, `5 runs in one session at ${chunk} bytes`);
    const v = one.map((r) => Number(r.cold_total_ms));
    must(`median of ${fmt(med(v))} and at worst ${fmt(Math.max(...v))}`, `${chunk}-byte chunks, the prose`);
    must(`median ${fmt(med(v))}, worst ${fmt(Math.max(...v))}`, `${chunk}-byte chunks, the numbers list`);
    const again = cold(chunk, 'true');
    assert.ok(again.length >= 1 && again.every((r) => r.match === 'true'), `the restart rows at ${chunk} bytes match`);
  }
  assert.deepEqual([...new Set(rows.map((r) => r.rows))].sort(), ['10000', '100000']);
  must('over 5 runs each', 'run count');
  assert.ok(rows.every((r) => r.commit === '0390d65-dirty'));
  must('0390d65-dirty', 'the commit label of the rows');
  assert.equal(readSibling('evidence', 'sprint-4/D1/SPEC-LANDED.txt').trim().split('\n').length, 122);
  must('122 sha256 values', 'SPEC-LANDED.txt');
  assert.match(readSibling('evidence', 'sprint-4/D1/test-demo-fix2.log'), /\b6 passed\b/);
  assert.match(readSibling('evidence', 'sprint-4/D1/test-demo-fix2.log'), /every Tamper lab case is refused with its documented reason/);
  must('6 passed', 'test-demo-fix2.log');
  const report = readSibling('workspace', 'SPRINT-4-REPORT.md');
  for (const id of ['43667709960', '43667700010', '43667716669', '43667716681', 'S1-099', 'TD-08']) {
    assert.ok(report.includes(id), `SPRINT-4-REPORT.md does not hold ${id}`);
    must(id, 'the report');
  }
  assert.match(report, /WebLLM was cut, not half-landed/);
  assert.match(report, /Sprints 3 and 4 were pushed on 15 Nov 2026/);
  must('15 November 2026', 'push date');
});

test('Sprint 5 write-up: finished, unlisted and noindex, five headings, every figure cites its file, the done-when is quoted as written and never called met', () => {
  const flat = assertFinishedWriteup(SPRINT5_WRITEUP, 5);
  assert.match(flat, /build done on Apple M5 Pro 48 GB; 8 GB Windows done-when NOT met \(owner runbook step 5\)/);
  assert.doesNotMatch(flat.replace(/NOT met/g, ''), /\bmet\b/);
  assert.match(flat, /Sprint 5 \(planned 4 January 2027 to 17 January 2027/);
});

test('Sprint 5 write-up: each figure equals the log it cites (the benchmark run, the end-to-end and gate runs, the unit suite, the size guard, the report)', () => {
  const flat = flatText(SPRINT5_WRITEUP);
  const must = (t, why) => assert.ok(flat.includes(t), `missing '${t}' (${why})`);
  const read = (rel) => readSibling('evidence', `sprint-5/ARCH/fresh-deps/logs/${rel}`);
  const bench = read('bench-e2e.log');
  const runs = [...bench.matchAll(/^run (\d+)(?: \(after a Chrome restart\))?: q1 first token (\d+) ms, total (\d+) ms, requests after offline (\d+), process RSS peak (\d+) bytes/gm)].map((m) => ({
    run: Number(m[1]), ttft: Number(m[2]), total: Number(m[3]), requests: Number(m[4]), rss: Number(m[5]), restart: /after a Chrome restart/.test(m[0]),
  }));
  assert.equal(runs.length, 6);
  assert.deepEqual(runs.map((r) => r.requests), [0, 0, 0, 0, 0, 0]);
  const session = runs.filter((r) => !r.restart);
  assert.equal(session.length, 5);
  const med = (v) => [...v].sort((a, b) => a - b)[v.length >> 1];
  const n = (x) => x.toLocaleString('en-US');
  const mib = (b) => `${n(Math.round(b / 1048576))} MiB`;
  must(`median ${n(med(session.map((r) => r.ttft)))} ms, worst ${n(Math.max(...session.map((r) => r.ttft)))} ms`, 'first token');
  must(`median ${n(med(session.map((r) => r.total)))} ms, worst ${n(Math.max(...session.map((r) => r.total)))} ms`, 'total');
  must(`median ${mib(med(session.map((r) => r.rss)))}, worst ${mib(Math.max(...session.map((r) => r.rss)))}`, 'peak memory');
  must('median of 6,283 MiB and at worst 6,377 MiB (about 6.2 GiB)', 'peak memory in the prose');
  // the grace-period question (q1): right and cited in 6 of 6 runs; the two questions that failed every run
  const lines = (q) => [...bench.matchAll(new RegExp(`^  \\[[\\d:]+\\] run (\\d+) ${q}: (.*)$`, 'gm'))].map((m) => m[2]);
  assert.equal(lines('q1').length, 6);
  assert.ok(lines('q1').every((l) => l.startsWith('answer ok, cited page ok')), 'q1 is right and cited in every run');
  must('6 of 6 runs', 'q1');
  for (const q of ['q2', 'q6']) assert.ok(lines(q).length === 6 && lines(q).every((l) => l.startsWith('answer NOT ok')), `${q} is wrong in every run`);
  must('The same two questions were wrong in every run', 'q2 and q6');
  const first = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].filter((q) => lines(q)[0].startsWith('answer ok, cited page ok')).length;
  assert.equal(first, 4);
  must('4 of 6 on the first run', 'first run');
  assert.match(bench, /question set: 24 of 36 answerable questions correct with the correct source page, over all 6 runs \(not selected\)/);
  must('24 of 36 answerable rows', 'the question set');
  assert.match(read('e2e.log'), /\b23 passed\b/);
  assert.match(read('gate.log'), /\b2 passed\b/);
  assert.match(read('final-dockit-ci.log'), /Tests\s+515 passed \(515\)/);
  must('23 passed', 'e2e.log');
  must('2 passed', 'gate.log');
  must('515 tests', 'final-dockit-ci.log');
  const size = read('size.txt');
  assert.match(size, /dist total \(du -sk x 1024, the guard's figure\): 821731328 bytes/);
  assert.match(size, /guard: 1,000,000,000 bytes/);
  must('821,731,328 bytes', 'size.txt');
  must('1,000,000,000 bytes', 'size.txt');
  const report = readSibling('workspace', 'SPRINT-5-REPORT.md');
  // the four red repositories of the first push, by their run ids (pagetriage, glyphsift, dockit, site), and the second push that fixed them
  for (const run of ['44325732090', '44325740893', '44325772916', '44325781731']) assert.ok(report.includes(run), `SPRINT-5-REPORT.md does not hold run ${run}`);
  assert.match(report, /pagetriage `1de5ff5\.\.eb28e49`, glyphsift `b3ea291\.\.ec6b108`, dockit `f8abddc\.\.840ec8b`, site\n`5974bb6\.\.fe2b00b`/);
  must('Four repositories went red', 'the report');
  assert.match(report, /build done on Apple M5 Pro 48 GB; 8 GB Windows done-when NOT met \(owner runbook step 5\)/);
});

test('Sprint 6 write-up: finished, unlisted and noindex, five headings, every figure cites its file, the done-when is quoted as written and never called met', () => {
  const flat = assertFinishedWriteup(SPRINT6_WRITEUP, 6);
  assert.match(flat, /build done on Apple M5 Pro 48 GB; 8 GB Windows done-when NOT met \(owner runbook step 5\)/);
  assert.match(flat, /Sprint 6's done-when is NOT met/);
  assert.doesNotMatch(flat.replace(/NOT met/g, ''), /\bmet\b/);
  assert.match(flat, /Sprint 6 \(planned 18 January 2027 to 31 January 2027/);
  assert.match(flat, /Finished on 20 November 2026/);
  assert.doesNotMatch(flat, /\bpublished\b|audited|compliant/i);
});

test('Sprint 6 write-up: each figure equals the file it cites (the baseline and re-measured CSVs, B1-result.md, the lock proof logs, the report)', async () => {
  const flat = flatText(SPRINT6_WRITEUP);
  const must = (t, why) => assert.ok(flat.includes(t), `missing '${t}' (${why})`);
  const n = (x) => x.toLocaleString('en-US');
  const { buildE2e } = await import('../scripts/import-dockit-bench.mjs');
  // before: recomputed from the baseline CSV fixture; after (Sprint 7 re-measure): recomputed from the current e2e.csv fixture
  const before = buildE2e(readSibling('dockit', 'docs/benchmarks/e2e-s6-baseline.csv'), readSibling('dockit', 'docs/benchmarks/e2e-questions-s6-baseline.csv'), { csvName: 'x', questionsName: 'y' });
  const after = buildE2e(readSibling('dockit', 'docs/benchmarks/e2e.csv'), readSibling('dockit', 'docs/benchmarks/e2e-questions.csv'), { csvName: 'x', questionsName: 'y' });
  const session = (set) => set.groups.find((g) => g.restart === false);
  const mib = (b) => Math.round(b / 1048576);
  const beforeMedian = session(before).process_rss_peak_bytes.median / 1048576;
  const afterMedian = session(after).process_rss_peak_bytes.median / 1048576;
  must(`median of ${n(mib(session(before).process_rss_peak_bytes.median))} MiB`, 'before, recomputed from the baseline CSV');
  must(`median of ${n(mib(session(after).process_rss_peak_bytes.median))} MiB`, 're-measure, recomputed from e2e.csv');
  must(`${n(Math.round(afterMedian - 5120))} MiB short of the 5,120 MiB target`, 'the re-measure against the target');
  assert.ok(afterMedian > 5120 && beforeMedian > afterMedian, 'the target is missed and the peak fell');
  must(`${after.questions.all.correct} of ${after.questions.all.of}`, 'question set over all runs');
  must(`${after.questions.firstRun.correct} of ${after.questions.firstRun.of}`, 'question set on the first run');
  assert.deepEqual([before.questions.all.correct, before.questions.all.of, after.questions.all.correct, after.questions.all.of], [24, 36, 24, 36], 'unchanged question set');
  assert.equal(Math.max(...[...before.groups, ...after.groups].map((g) => g.requests_after_offline.max)), 0);
  must('0 requests after the network was blocked in every run of both sets', 'requests');
  must(`median per-question total of ${n(Math.round(after.questions.timing.total_ms.median))} ms`, 're-measure time');
  // Sprint 6's own after-run: B1-result.md (the committed CSV of that run was replaced by the quiet re-measure)
  const b1 = readSibling('evidence', 'sprint-6/D5/B1-result.md');
  for (const t of ['5,440.8 MiB', '866.7 MiB', '13.7 percent', '320.8 MiB', '9,390.5 ms', '11,950 ms', 'at most 5,120 MiB', 'q2 and q6 wrong in all 6 runs in both sets']) assert.ok(b1.includes(t), `B1-result.md does not hold '${t}'`);
  for (const t of ['5,440.8 MiB', '866.7 MiB', '13.7 percent', '9,390.5 ms', '11,950 ms']) must(t, 'B1-result.md');
  must('q2 and q6 were wrong in every run of both sets', 'B1-result.md');
  // the lock proof from fresh clones at the locks
  assert.match(readSibling('evidence', 'sprint-6/architect/lockproof-logs/e2e.log'), /\b31 passed\b/);
  assert.match(readSibling('evidence', 'sprint-6/architect/lockproof-logs/gate.log'), /\b2 passed\b/);
  assert.match(readSibling('evidence', 'sprint-6/architect/lockproof-logs/size.txt'), /dist total \(du -sk x 1024, the guard's figure\): 821882880 bytes/);
  must('31 of 31', 'e2e.log');
  must('2 of 2', 'gate.log');
  must('821,882,880 bytes', 'size.txt');
  // S1-107: the font bomb
  const bomb = readSibling('evidence', 'sprint-6/architect/lockproof-logs/e2e.log').match(/S1-107 peak: (\{"case":"font bomb[^\n]*\})/)?.[1];
  assert.ok(bomb, 'the font bomb line is in e2e.log');
  const peak = JSON.parse(bomb);
  assert.deepEqual([peak.idleRssMiB, peak.peakRssMiB, peak.sprint5FontBombPeakMiB], [3073, 3077, 8121]);
  must('3,077 MiB against 3,073 MiB idle', 'the font bomb peak');
  must('8,121 MiB', 'the Sprint 5 font bomb');
  // the report: weak keys, HNSW and the commercial drafts
  const report = readSibling('workspace', 'SPRINT-6-REPORT.md');
  for (const t of ['have 26 rows, 20 of them refused', 'recall@10 is 0.9965 / 1 / 1', '0.90 at ef 128 is met', 'Uniform data at 100k x 384 has no floor', 'The team did not produce even the grant draft this sprint']) assert.ok(report.includes(t), `SPRINT-6-REPORT.md does not hold '${t}'`);
  must('26 rows, 20 of them refused', 'weak keys');
  must('0.9965 / 1 / 1 at ef 32 / 64 / 128', 'HNSW recall');
  must('0.045 / 0.0755 / 0.1375', 'uniform recall');
  assert.ok(report.includes('0.045 / 0.0755 / 0.1375'));
});

test('Sprint 7 write-up: an unlisted noindex skeleton with the five headings, each marked for the product owner, no figures, and it never calls a done-when met', () => {
  const html = SPRINT7_WRITEUP;
  assert.match(html, /<meta name="draft" content="true"/);
  const heads = [...html.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(heads, FIVE_HEADINGS);
  for (const sec of html.split(/<h2>/).slice(1)) assert.ok(sec.includes('[product owner to finish at close-out]'));
  assert.doesNotMatch(html, /\/private\/tmp|<script|\sstyle="|https?:\/\//i);
  assert.doesNotMatch(html.replace(/NOT met/g, ''), /\bmet\b/);
  assert.match(html, /an addition the owner asked for on 19 November 2026/);
  assert.match(html, /the first gate is stated as it stands/);
  const stray = figureElements(html).filter(hasStrayNumber);
  assert.deepEqual(stray, [], `figures in the skeleton: ${stray.join(' || ')}`);
  const { out } = buildToTemp();
  const built = readFileSync(join(out, 'writeups', '2026-11-sprint-7', 'index.html'), 'utf8');
  assert.match(built, /<meta name="robots" content="noindex" \/>/);
  assert.doesNotMatch(readFileSync(join(out, 'writeups', 'index.html'), 'utf8'), /2026-11-sprint-7|Sprint 7/);
});

test('every Sprint write-up draft is linked from no page and carries no scratch path', () => {
  const { out } = buildToTemp();
  for (const file of walk(out).filter((f) => f.endsWith('.html'))) {
    const rel = file.slice(out.length + 1).replaceAll('\\', '/');
    const html = readFileSync(file, 'utf8');
    assert.doesNotMatch(html, /\/private\/tmp/, `${rel} names a scratch path`);
    if (/^writeups\/2026-11-sprint-[34567]\//.test(rel)) continue;
    assert.doesNotMatch(html, /href="[^"]*2026-11-sprint-[34567]/, `${rel} links to a sprint write-up draft`);
  }
});

// Sprint 4 (D5-05, droppable third): the two Sprint 3 slots are filled from the saved DevTools-panel figures. Since 20 Nov 2026 the source is the raw file runtime commits
// (runtime/docs/benchmarks/devtools-load-phases.json: one headed run), not the workspace evidence of two runs; test/bench-sources.test.mjs holds the exact figure check.
const RT_DEVTOOLS = 'docs/benchmarks/devtools-load-phases.json';
const fmtMs = (n) => `${Number(n.toFixed(1)).toLocaleString('en-US')} ms`;

test('Sprint 3 slots are filled from the figures runtime commits (devtools-load-phases.json), command RUNTIME_MODEL=1 RUNTIME_DEVTOOLS_HEADED=1 npm run test:devtools, labelled Apple silicon', () => {
  const data = JSON.parse(readFileSync(join(root, 'data', 'benchmarks.json'), 'utf8'));
  const timing = data.rows.find((r) => /model-load timing per phase/i.test(r.benchmark));
  const mem = data.rows.find((r) => /memory at model load/i.test(r.benchmark));
  assert.ok(timing && mem, 'timing and memory rows missing');
  assert.match(timing.benchmark, /acquire, verify, hand-off, session, first token/);
  assert.match(timing.benchmark, /SmolLM2-135M, WebAssembly engine in a worker/);
  assert.match(mem.benchmark, /page JS heap where Chrome exposes it; worker where exposed/);
  for (const r of [timing, mem]) {
    assert.equal(r.repo, 'runtime');
    assert.equal(r.command, 'RUNTIME_MODEL=1 RUNTIME_DEVTOOLS_HEADED=1 npm run test:devtools');
    assert.equal(r.laptop, 'not measured on 8 GB', 'the 8 GB cell stays not measured on 8 GB');
    assert.match(r.dev, /^Apple silicon, Chrome\/157\.0\.8103\.79/);
    assert.equal(r.evidence, `runtime/${RT_DEVTOOLS}`);
    assert.match(r.notes, /placeholder until the 8 GB laptop is measured/);
    assert.match(r.notes, /not measured on 8 GB/);
    assert.doesNotMatch(r.dev + r.notes, /not yet run/);
  }
  assert.match(timing.dev, /WebGPU not measured here/);
  assert.match(mem.dev, /worker heap and WebAssembly memory were not exposed/);
  // Every figure equals the committed raw file (the committed fixture of runtime's file, or its live copy under test:siblings).
  {
    const run = JSON.parse(readSibling('runtime', RT_DEVTOOLS)).files[0].json;
    assert.ok(timing.dev.includes(run.chrome), 'Chrome version');
    for (const phase of ['acquire', 'verify', 'handoff', 'session', 'first_token']) {
      const want = fmtMs(run.panelPhaseDurationsMs[phase]);
      assert.ok(timing.dev.includes(want), `${phase} ${want} not in the timing cell`);
    }
    const heap = run.panelMemory.filter((x) => (x.scope ?? 'page') === 'page' && x.api === 'performance.memory');
    assert.equal(heap.length, 3);
    for (const m of heap) assert.ok(mem.dev.includes(m.used), `${m.at} ${m.used} not in the memory cell`);
  }
  // WebLLM did not land and was cut from Sprint 4 (TD-08): no WebLLM row may exist.
  assert.equal(data.rows.some((r) => /WebLLM/.test(r.benchmark)), false, 'no WebLLM row: the rung is cut from Sprint 4');
});

test('glyphsift score-versus-noise row carries the mixed means recomputed from the committed CSV and its provenance file', () => {
  const data = JSON.parse(readFileSync(join(root, 'data', 'benchmarks.json'), 'utf8'));
  const gs = data.rows.find((r) => /score versus noise/i.test(r.benchmark));
  const FIGURES = ['1,000,000', '998,476', '996,985', '991,696', '983,977', '967,538', '933,440'];
  assert.equal(
    gs.dev,
    `Mixed-family mean, ppm, at p = 0, 0.01, 0.02, 0.05, 0.1, 0.2, 0.4: ${FIGURES.join('; ')}. Falls at every step.`,
  );
  assert.equal(gs.evidence, 'glyphsift/docs/benchmarks/score-vs-noise.csv and glyphsift/docs/benchmarks/score-vs-noise.provenance.json');
  assert.equal(gs.laptop, 'not measured on 8 GB');
  for (const old of ['998,454', '996,931', '991,588', '983,739', '967,065', '932,405']) {
    assert.ok(!gs.dev.includes(old), `stale Sprint 2 figure ${old} still in the row`);
  }
});

test('the glyphsift row equals a fresh computation over glyphsift docs/benchmarks/score-vs-noise.csv (committed fixture)', () => {
  const [head, ...lines] = readSibling('glyphsift', 'docs/benchmarks/score-vs-noise.csv').trim().split('\n');
  const ix = Object.fromEntries(head.split(',').map((c, i) => [c, i]));
  const byP = new Map();
  for (const line of lines) {
    const f = line.split(',');
    if (f[ix.family] !== 'mixed') continue;
    if (!byP.has(f[ix.p])) byP.set(f[ix.p], []);
    byP.get(f[ix.p]).push(Number(f[ix.score_ppm]));
  }
  const ps = [...byP.keys()].sort((a, b) => Number(a) - Number(b));
  assert.equal(ps.join(', '), '0, 0.01, 0.02, 0.05, 0.1, 0.2, 0.4');
  const figures = ps.map((p) => Math.round(byP.get(p).reduce((a, b) => a + b, 0) / byP.get(p).length).toLocaleString('en-US'));
  const data = JSON.parse(readFileSync(join(root, 'data', 'benchmarks.json'), 'utf8'));
  const gs = data.rows.find((r) => /score versus noise/i.test(r.benchmark));
  assert.ok(gs.dev.includes(figures.join('; ')), `row does not match the CSV: ${figures.join('; ')}`);
});

// ---- Sprint 4 (D5-03, TD-06 amended, TD-24): marks settled only where a file already says so ----

const LICENSING_SRC = readFileSync(join(root, 'src', 'pages', 'licensing.html'), 'utf8');
const MARK = /\[owner to confirm/g;

/** Every `<!-- source: <path>:<line> | <verbatim fragment> -->` comment, grouped by the <li data-settled="..."> that holds it. */
function settledItems(html) {
  const items = [];
  for (const m of html.matchAll(/<li data-settled="([a-z-]+)">([\s\S]*?)<\/li>/g)) {
    const sources = [...m[2].matchAll(/<!-- source: ([^|]+?)(?::(\d+))? \| (.+?) -->/g)].map((c) => ({ path: c[1], line: c[2] === undefined ? undefined : Number(c[2]), fragment: c[3] }));
    const text = m[2].replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    items.push({ key: m[1], sources, text });
  }
  return items;
}

test('licensing page: exactly two [owner to confirm] marks in list items (CLA or DCO, trademark) plus the banner', () => {
  const noComments = LICENSING_SRC.replace(/<!--[\s\S]*?-->/g, '');
  const banner = /<section class="box box-warn" id="draft-banner">([\s\S]*?)<\/section>/.exec(noComments)?.[1] ?? '';
  assert.equal((banner.match(MARK) ?? []).length, 1, 'the banner carries exactly one mark');
  const lis = [...noComments.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  const marked = lis.filter((t) => /\[owner to confirm/.test(t));
  assert.equal(marked.length, 2, `list items with a mark: ${JSON.stringify(marked)}`);
  assert.ok(marked.some((t) => t.includes('CLA or DCO [owner to confirm]')), 'CLA or DCO [owner to confirm] must stay');
  assert.ok(marked.some((t) => t.includes('Trademark and name use. [owner to confirm]')), 'Trademark and name use. [owner to confirm] must stay');
  assert.equal((noComments.match(MARK) ?? []).length, 3, 'one banner mark and two list marks, nowhere else');
  // A third list mark would be allowed only if the inbound = outbound text had no source; every public repo's CONTRIBUTING file states it.
  const contributions = settledItems(LICENSING_SRC).find((i) => i.key === 'contributions');
  assert.ok(contributions && contributions.sources.length >= 6, 'the contributions item cites a CONTRIBUTING file per repository');
});

test('licensing page: the banner records the team settlement under owner delegation', () => {
  const flat = LICENSING_SRC.replace(/\s+/g, ' ');
  assert.ok(
    flat.includes('Marks settled by the team under owner delegation on 14 Nov 2026 only where a LICENSE, CONTRIBUTING or spec file already says so; the owner approves before publishing'),
    'banner sentence missing',
  );
  assert.match(flat, /Draft for owner review\. Not yet published as policy\./);
});

test('licensing page: every settled item has source comments, and each cited line states the text verbatim', () => {
  const items = settledItems(LICENSING_SRC);
  assert.deepEqual(items.map((i) => i.key), ['commitment', 'core', 'specs', 'control-plane', 'contributions']);
  for (const item of items) {
    assert.ok(item.sources.length >= 1, `${item.key}: no <!-- source: path:line | fragment --> comment`);
    for (const src of item.sources) {
      assert.ok(src.fragment.length >= 8, `${item.key}: fragment too short to prove anything`);
      // Citations into sibling repositories and the plan documents carry the file and the verbatim fragment and NO line
      // number (those files move while other lanes edit them); only site-internal citations keep a line.
      assert.equal(src.line === undefined, !src.path.startsWith('site/'), `${item.key}: ${src.path} line-number rule (site/ keeps one, everything else has none)`);
      // site/ citations are read from this repository; every other citation from the committed fixture (or the live file in test:siblings).
      const lines = (src.path.startsWith('site/') ? readFileSync(join(root, src.path.slice(5)), 'utf8') : readCitation(src.path)).split('\n');
      assert.ok(lines.some((l) => l.includes(src.fragment)), `${item.key}: '${src.fragment}' is not in ${src.path}`);
      if (src.path.startsWith('site/')) {
        assert.ok(lines[src.line - 1]?.includes(src.fragment), `${item.key}: ${src.path}:${src.line} does not hold '${src.fragment}'`);
      }
    }
  }
  // The settled text itself.
  const by = Object.fromEntries(items.map((i) => [i.key, i.text]));
  assert.match(by.commitment, /never relicense the core/);
  assert.match(by.commitment, /MIT OR Apache-2\.0/);
  assert.match(by.core, /six public repositories/);
  for (const r of ['pagetriage', 'glyphsift', 'localdata', 'runtime', 'dockit', 'site']) assert.ok(by.core.includes(r), `core: ${r}`);
  assert.match(by.core, /CC BY 4\.0/);
  assert.match(by.specs, /never move behind the control-plane licence/);
  assert.match(by['control-plane'], /FSL-1\.1-Apache-2\.0/);
  assert.match(by['control-plane'], /second anniversary/);
  assert.match(by['control-plane'], /No commitment beyond/);
  assert.match(by.contributions, /accepted under the licence of the repository/);
});

test('licensing page: a sibling citation whose fragment is missing from the cited file is detected', () => {
  const sib = settledItems(LICENSING_SRC).flatMap((i) => i.sources).filter((x) => !x.path.startsWith('site/'));
  assert.ok(sib.length >= 10, 'sibling citations exist');
  const has = (x, frag) => readCitation(x.path).includes(frag);
  for (const x of sib) {
    assert.ok(has(x, x.fragment), `${x.path} holds its fragment`);
    assert.ok(!has(x, `${x.fragment} (not in this file ${Date.now()})`), 'a doctored fragment is reported missing');
  }
});

test('licensing page: the paid list makes no compliance claim (TD-27 under TD-14)', () => {
  const flat = LICENSING_SRC.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.doesNotMatch(flat, /DPDP|GDPR|compliance export/i);
  assert.ok(flat.includes('audit logs and an evidence export (planned; no compliance claim)'));
});

test('licensing page: no "no CLA" text, the pricing sentence keeps its text and loses only its mark, no price or term appears', () => {
  const flat = LICENSING_SRC.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ');
  assert.doesNotMatch(flat, /\bno CLA\b/i);
  assert.doesNotMatch(flat, /\bno DCO\b/i);
  assert.ok(flat.includes('Pricing, terms and which of these ship first are not part of this page.'));
  assert.doesNotMatch(flat, /Pricing, terms and which of these ship first are not part of this page\.\s*\[owner/);
  assert.doesNotMatch(flat, /(?:₹|\$|USD|INR|EUR|£)\s?\d|\d+\s?(?:per month|per user|\/month|a year|per year)/i, 'no price or term');
});

test('licensing page: the cited source lines are listed in site/README.md', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  for (const item of settledItems(LICENSING_SRC)) {
    for (const src of item.sources) {
      const cite = src.line === undefined ? src.path : `${src.path}:${src.line}`;
      assert.ok(readme.includes(cite), `README does not list ${cite} (${item.key})`);
      if (src.line === undefined) assert.doesNotMatch(readme, new RegExp(`${src.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\d+`), `README cites ${src.path} with a line number`);
    }
  }
  assert.match(readme.replace(/\s+/g, ' '), /CLA or DCO \[owner to confirm\]/);
  assert.match(readme.replace(/\s+/g, ' '), /Trademark and name use\. \[owner to confirm\]/);
});

test('licensing page stays noindex and linked from no page (also no sitemap or feed entry)', () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'licensing', 'index.html'), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex" \/>/);
  for (const file of walk(out)) {
    if (file === join(out, 'licensing', 'index.html')) continue;
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /href="[^"]*licensing\/?"/i, `${file} links to the licensing draft`);
  }
  assert.ok(!existsSync(join(out, 'sitemap.xml')) && !existsSync(join(out, 'feed.xml')), 'no sitemap or feed may list the draft');
});

test('the site README owner step covers the nav link, the draft meta, the #draft-banner and the (draft) title', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8').replace(/\s+/g, ' ');
  const step = /To publish the licensing page after approval(.*?)(##|$)/s.exec(readme)?.[1] ?? '';
  assert.ok(step.length > 0, 'owner step missing');
  assert.match(step, /nav/i);
  assert.match(step, /licensing\//);
  assert.match(step, /<meta name="draft"/);
  assert.match(step, /#draft-banner/);
  assert.match(step, /\(draft\)/);
  assert.match(step, /title/i);
});

test('site README follows the conventions order and carries the Install sentence (N/A for an application)', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const heads = [...readme.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  const at = (h) => heads.findIndex((x) => x.startsWith(h));
  const order = ['Status', 'Install', 'Quick start', 'How it works', 'Contracts', 'Demo', 'Benchmarks', 'Limitations', 'Security and privacy', 'Develop', 'Licence'];
  const idx = order.map(at);
  assert.ok(idx.every((i) => i >= 0), `missing section in ${heads.join(' | ')}`);
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, `sections out of order: ${heads.join(' | ')}`);
  assert.ok(at('Licensing draft') > at('Demo'), 'Licensing draft comes after Demo');
  assert.ok(at('Licensing draft') < at('Benchmarks'));
  const install = /## Install(.*?)\n## /s.exec(readme)?.[1] ?? '';
  assert.match(install.replace(/\s+/g, ' '), /Not a registry package/);
  assert.match(install.replace(/\s+/g, ' '), /deployed to GitHub Pages/);
});

test('the Sprint 2 write-up carries a dated correction: WebLLM moved to Sprint 4', () => {
  const flat = readFileSync(join(root, 'writeups', '2026-11-sprint-2.html'), 'utf8').replace(/\s+/g, ' ');
  assert.match(flat, /Correction, 14 November 2026/);
  assert.match(flat, /WebLLM backend moved to Sprint 4/);
  assert.match(flat, /WebLLM was then cut from Sprint 4 \(TD-08, not yet\)/);
  assert.match(flat, /Sprint 3 is the runtime alpha, including the WebLLM backend/, 'the original sentence stays; the correction is appended, not a silent rewrite');
});

test('the home page repository table shows Sprint 7 statuses (TD-107 versions), not the Sprint 1 ones', () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  for (const stale of ['validator lands in Sprint 2', 'drivers and behavioural suite in Sprint 1', 'Sprint 1: specs, capability profile and asset manager', 'release preparation in progress', 'Skeleton; tests written']) {
    assert.ok(!html.includes(stale), `stale home status: ${stale}`);
  }
  const row = (repo) => new RegExp(`<tr><td>(?:<a [^>]*>)?${repo}(?:</a>)?</td>.*?</tr>`).exec(html)?.[0] ?? '';
  assert.match(row('glyphsift'), /Release candidate 0\.1\.3 \(not tagged, not published\)/);
  assert.match(row('runtime'), /Beta 0\.3\.0-beta\.2 on spec release 0\.6\.1 \(not tagged, not published, not tag-ready\)/);
  assert.match(row('runtime'), /WebLLM: not yet \(cut\)/);
  assert.doesNotMatch(row('runtime'), /WebLLM is Sprint 4/);
  assert.match(row('localdata'), /0\.4\.0-alpha\.1/);
  assert.match(row('localdata'), /optional HNSW graph/);
  assert.doesNotMatch(row('localdata'), /0\.1\.0-dev|lands in Sprint 4/);
  assert.match(row('pagetriage'), /1\.0\.0-rc\.1/);
  assert.match(row('pagetriage'), /not published, no tag yet/);
  assert.doesNotMatch(row('pagetriage'), /\b1\.0\.0(?!-rc)/);
  assert.match(row('dockit'), /0\.4\.0-dev \(private, never published to a registry\)/);
  // The licence column still equals data/licences.json for the six public repos plus control-plane.
  assert.match(row('pagetriage'), /MIT OR Apache-2\.0/);
});

// ---- Sprint 4 (D5-05): localdata vector-index benchmark rows fed from D4's CSV ----

const FIXTURE_CSV = join(root, 'test', 'fixtures', 'vector-index.csv');
const bench = () => import('../scripts/import-localdata-bench.mjs');
const LABEL_256 = 'localdata flat index, 100,000 x 384 + 256-byte synthetic chunks, OPFS, cold open + first query (median / worst of N)';
const LABEL_2048 = 'localdata flat index, 100,000 x 384 + 2,048-byte synthetic chunks, OPFS, cold open + first query (median / worst of N)';

// The fixture CSV's machine column reads 'synthetic fixture' on purpose: the rows are not measurements.
test('importer: with the fixture CSV both chunk-size rows carry median and worst of the cold runs, the restart run, the CSV path and the commit as written', async () => {
  const { buildLocaldataRows, CSV_CITE } = await bench();
  const rows = buildLocaldataRows(readFileSync(FIXTURE_CSV, 'utf8'));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].benchmark, LABEL_256.replace('worst of N', 'worst of 5'));
  assert.equal(rows[1].benchmark, LABEL_2048.replace('worst of N', 'worst of 5'));
  assert.equal(CSV_CITE, 'localdata/docs/benchmarks/vector-index.csv');
  const [r256, r2048] = rows;
  assert.match(r256.dev, /^synthetic fixture: median 1,250 ms \/ worst 1,500 ms of 5 cold runs; browser-restart run 1,400 ms/);
  assert.match(r2048.dev, /^synthetic fixture: median 1,700 ms \/ worst 1,900 ms of 5 cold runs; browser-restart run 1,750 ms/);
  for (const r of rows) {
    assert.equal(r.repo, 'localdata');
    assert.equal(r.command, 'npm run bench:vectors');
    assert.equal(r.laptop, 'not measured on 8 GB');
    assert.equal(r.evidence, 'localdata/docs/benchmarks/vector-index.csv');
    assert.match(r.notes, /uncommitted working tree based on abc1234 \(commit column: abc1234-dirty\)/);
    assert.match(r.notes, /not measured on 8 GB/);
    assert.match(r.notes, /precise memory info/);
    assert.match(r.notes, /synthetic fixture/);
    assert.doesNotMatch(r.dev + r.notes, /\b(111|222)\b/, 'the 10k and IndexedDB rows are not part of these two rows');
  }
});

test('importer: a clean commit is shown as written, and a CSV with no restart run says so', async () => {
  const { buildLocaldataRows } = await bench();
  const csv = readFileSync(FIXTURE_CSV, 'utf8').replaceAll('abc1234-dirty', 'abc1234').split('\n').filter((l) => !/,true,\d+,\d+,\d+,\d+,[\d.]+,[\d.]+,[\d.]+,\d+,\d+,\d+,\d+,true$/.test(l)).join('\n');
  const [r] = buildLocaldataRows(csv);
  assert.match(r.notes, /commit abc1234 \(commit column: abc1234\)/);
  assert.doesNotMatch(r.notes, /uncommitted/);
  assert.match(r.dev, /no browser-restart run in the CSV/);
});

test('importer: a restart=true row is never counted as a cold run (real localdata CSV header: boolean restart column, run = 1..6)', async () => {
  const { buildLocaldataRows, parseCsv } = await bench();
  const text = readFileSync(FIXTURE_CSV, 'utf8');
  assert.equal(text.split('\n')[0], readSibling('localdata', 'docs/benchmarks/vector-index.csv').split('\n')[0], 'fixture header equals the real header');
  const recs = parseCsv(text).filter((r) => r.rows === '100000' && r.chunk_bytes === '256');
  assert.equal(recs.filter((r) => r.restart === 'true').length, 1);
  assert.deepEqual(recs.map((r) => r.run), ['1', '2', '3', '4', '5', '6']);
  const [r256] = buildLocaldataRows(text);
  assert.match(r256.benchmark, /worst of 5\)$/);
  assert.match(r256.dev, /of 5 cold runs; browser-restart run 1,400 ms$/);
  // make the restart row slower than any cold run: it must not move the worst
  const slow = text.replace(',true,6,100,10,1390,1400,', ',true,6,100,10,9990,9999,');
  assert.notEqual(slow, text);
  const [s256] = buildLocaldataRows(slow);
  assert.match(s256.dev, /worst 1,500 ms of 5 cold runs; browser-restart run 9,999 ms/);
});

test('importer: no CSV means both rows read not measured (the 8 GB column: not measured on 8 GB), with no figure and no evidence', async () => {
  const { buildLocaldataRows } = await bench();
  const rows = buildLocaldataRows(undefined);
  assert.deepEqual(rows.map((r) => r.benchmark), [LABEL_256, LABEL_2048]);
  for (const r of rows) {
    assert.equal(r.dev, 'not measured');
    assert.equal(r.laptop, 'not measured on 8 GB');
    assert.equal(r.command, 'npm run bench:vectors');
    assert.equal(r.evidence, undefined);
    assert.match(r.notes, /not measured on 8 GB/);
    assert.doesNotMatch(r.dev + r.notes, /\d+(\.\d+)?\s*ms\b/);
  }
});

test('importer: refuses a row whose match is not true, a missing column and a missing size, instead of showing a wrong figure', async () => {
  const { buildLocaldataRows } = await bench();
  const good = readFileSync(FIXTURE_CSV, 'utf8');
  assert.throws(() => buildLocaldataRows(good.replace(/(,256,false,3,[^\n]*),true\n/, '$1,false\n')), /match/i);
  assert.throws(() => buildLocaldataRows(good.replace('cold_total_ms', 'cold_ms')), /cold_total_ms/);
  assert.throws(() => buildLocaldataRows(good.split('\n').filter((l) => !/,2048,/.test(l)).join('\n')), /2048|2,048/);
  assert.throws(() => buildLocaldataRows('driver\n'), /column|row/i);
});

test('importer: CSV parsing handles quoted commas and CRLF', async () => {
  const { parseCsv } = await bench();
  assert.deepEqual(parseCsv('a,b\r\n"x, y",2\r\n'), [{ a: 'x, y', b: '2' }]);
  assert.deepEqual(parseCsv('a,b\n1,"he said ""hi"""\n'), [{ a: '1', b: 'he said "hi"' }]);
});

test('importer: importBench rewrites only the two localdata rows, is idempotent, and falls back to not measured when the CSV is absent', async () => {
  const { importBench } = await bench();
  const tmp = mkdtempSync(join(tmpdir(), 'amlabs-site-bench-'));
  mkdirSync(join(tmp, 'data'));
  const original = JSON.parse(readFileSync(join(root, 'data', 'benchmarks.json'), 'utf8'));
  writeFileSync(join(tmp, 'data', 'benchmarks.json'), JSON.stringify(original, null, 2) + '\n');
  const others = (d) => d.rows.filter((r) => !/^localdata flat index/.test(r.benchmark));
  importBench({ siteRoot: tmp, csvPath: join(tmp, 'absent.csv') });
  const absent = JSON.parse(readFileSync(join(tmp, 'data', 'benchmarks.json'), 'utf8'));
  assert.equal(absent.rows.filter((r) => /^localdata flat index/.test(r.benchmark)).length, 2);
  assert.deepEqual(others(absent), others(original));
  importBench({ siteRoot: tmp, csvPath: FIXTURE_CSV });
  const once = readFileSync(join(tmp, 'data', 'benchmarks.json'), 'utf8');
  importBench({ siteRoot: tmp, csvPath: FIXTURE_CSV });
  assert.equal(readFileSync(join(tmp, 'data', 'benchmarks.json'), 'utf8'), once, 'a second run changes nothing');
  const measured = JSON.parse(once);
  assert.equal(measured.rows.filter((r) => /^localdata flat index/.test(r.benchmark)).length, 2);
  assert.deepEqual(others(measured), others(original));
});

test('benchmarks.json: the two localdata rows equal the importer output for the localdata CSV (committed fixture)', async () => {
  const { buildLocaldataRows } = await bench();
  const data = JSON.parse(readFileSync(join(root, 'data', 'benchmarks.json'), 'utf8'));
  const mine = data.rows.filter((r) => /^localdata flat index/.test(r.benchmark));
  assert.equal(mine.length, 2, 'both chunk-size rows must exist');
  assert.ok(/256-byte/.test(mine[0].benchmark) && /2,048-byte/.test(mine[1].benchmark));
  for (const r of mine) assert.equal(r.laptop, 'not measured on 8 GB');
  assert.deepEqual(mine, buildLocaldataRows(readSibling('localdata', 'docs/benchmarks/vector-index.csv')), 'run: node scripts/import-localdata-bench.mjs (against the localdata CSV; then re-cut the fixtures)');
});

test('the built benchmarks page shows both localdata chunk-size rows, and every 8 GB cell in them reads not measured on 8 GB', () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'benchmarks', 'index.html'), 'utf8');
  const rows = [...html.matchAll(/<tr><td>localdata flat index.*?<\/tr>/gs)].map((m) => m[0]);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /256-byte synthetic chunks/);
  assert.match(rows[1], /2,048-byte synthetic chunks/);
  for (const row of rows) {
    const cells = [...row.matchAll(/<td>(.*?)<\/td>/gs)].map((m) => m[1]);
    assert.equal(cells[4], 'not measured on 8 GB', 'the 8 GB Windows no-GPU laptop cell');
    assert.match(row, /npm run bench:vectors/);
    assert.match(row, /not measured on 8 GB/);
  }
});

test('T3-R2-04: no 8 GB cell of the older benchmarks table reads the bare phrase "not measured", in the data or on the built page', () => {
  const data = JSON.parse(readFileSync(join(root, 'data', 'benchmarks.json'), 'utf8'));
  assert.equal(data.columns[4], '8 GB Windows no-GPU laptop');
  assert.ok(data.rows.length >= 14);
  for (const r of data.rows) assert.equal(r.laptop, 'not measured on 8 GB', `${r.benchmark}: 8 GB cell in data/benchmarks.json`);
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'benchmarks', 'index.html'), 'utf8');
  // the older table is everything before the dockit end-to-end section
  const older = html.split('<h2 id="dockit-e2e">')[0];
  const rows = [...older.matchAll(/<tr><td>.*?<\/tr>/gs)].map((m) => m[0]);
  assert.equal(rows.length, data.rows.length, 'one rendered row per data row');
  for (const row of rows) {
    const cells = [...row.matchAll(/<td>(.*?)<\/td>/gs)].map((m) => m[1]);
    assert.notEqual(cells[4], 'not measured', `bare "not measured" in an 8 GB cell: ${row}`);
    assert.equal(cells[4], 'not measured on 8 GB', `8 GB cell: ${row}`);
  }
});

// ---- Sprint 4 (D5-06): demos lines for dockit and site, the WebLLM wording, the spec wording, the gap-3 sweep (TD-11) ----

test('demos.json dockit line is the Sprint 7 line: the same app, the memory re-measured on a quiet machine with its target outcome, the Windows benchmark as it ran (read from the committed emulated data), 8 GB not measured, WebLLM cut', () => {
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  const line = demos.find((d) => d.repo === 'dockit').status;
  const [claimed, notYet] = line.split(/Not yet: /);
  assert.ok(notYet, 'dockit line has a Not yet tail');
  assert.match(claimed, /^Sprint 7 \(20 Nov 2026\): Working: the same app as Sprint 6 \(ask a question about a PDF and read an answer from a small local model, Qwen3-0\.6B in WebAssembly, with the source pages shown, one model in memory at a time; nothing about the page changed in Sprint 7\)/);
  assert.match(claimed, /re-measured on a quiet machine on the committed Sprint 6 build/);
  // the Windows clause is the committed emulated rows' own: what the data says, not what was typed
  const emu = JSON.parse(readFileSync(join(root, 'data', 'e2e-emulated.json'), 'utf8'));
  const gibs = (ls) => ls.map((l) => `${l.limitBytes / 1073741824} GiB`);
  const listOf = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);
  const capped = emu.legs.filter((l) => l.limitBytes !== null);
  assert.ok(capped.every((l) => l.limitProof === 'proven'), 'the line may say the limit is proven only if the data says so');
  assert.ok(claimed.includes('a Windows benchmark under an emulated memory cap (a GitHub-hosted virtual machine with 4 vCPU and 16 GB RAM, never a laptop) has run'));
  assert.ok(claimed.includes(`the commit limit of its ${listOf(gibs(capped))} legs is proven in force`));
  assert.ok(claimed.includes(`all ${emu.legs.length} legs finished`) && emu.legs.every((l) => l.result === 'pass'));
  const refused = capped.filter((l) => l.benchmarkMessages > 0);
  assert.ok(claimed.includes(`commits were refused while the benchmark ran on the ${listOf(gibs(refused))} ${refused.length === 1 ? 'leg' : 'legs'} and it still finished`));
  assert.ok(emu.controlLegs.every((c) => c.outcome === 'incomplete' && c.limitProof === 'proven') && claimed.includes('the 2 GiB control leg, which must not finish, did not finish'));
  assert.ok(claimed.includes('it limits committed memory on one virtual machine, so it is not a laptop figure and fills no 8 GB cell'));
  assert.doesNotMatch(claimed, /has not run|is written and|pending its first run/);
  assert.match(claimed, /not measured on 8 GB/);
  assert.match(claimed, /live since the owner's push of 18 Nov 2026/);
  assert.doesNotMatch(claimed, /WebLLM/);
  for (const t of ['OCR', 'a Windows or 8 GB laptop figure (the emulated Windows run is not one)', 'the pilot model (Qwen3-1.7B)', 'a real signing key', 'WebLLM (cut)', 'multi-document chat']) assert.ok(notYet.includes(t), `not-yet tail lacks ${t}`);
  assert.doesNotMatch(line, /\bmet\b|published|audited|compliant/i);
  assert.doesNotMatch(line, /(?<!not )measured on 8 GB/);
  assert.doesNotMatch(line, /free RAM/i);
  // the memory figures are the medians of the committed CSVs (the same files the benchmarks page is built from)
  const e2e = JSON.parse(readFileSync(join(root, 'data', 'e2e.json'), 'utf8'));
  const mib = (b) => Math.round(b / 1048576).toLocaleString('en-US');
  const session = (set) => set.groups.find((g) => g.restart === false);
  assert.ok(claimed.includes(`a median of ${mib(session(e2e).process_rss_peak_bytes.median)} MiB, down from ${mib(session(e2e.baseline).process_rss_peak_bytes.median)} MiB before the Sprint 6 memory work`));
  assert.equal(session(e2e).process_rss_peak_bytes.median / 1048576 > e2e.target.rssMedianMiB, claimed.includes('still short of the 5,120 MiB target'), "the target outcome in the line is the data's");
  assert.ok(claimed.includes(`with the fixed question set at ${e2e.questions.all.correct} of ${e2e.questions.all.of}`));
  assert.ok(claimed.includes(`a median answer time of ${e2e.questions.timing.total_ms.median.toLocaleString('en-US')} ms`));
});

test('demos.json site line is the Sprint 7 line: the Start here page, the emulated section built from dockit\'s committed rows, the re-measured dockit figures, the Sprint 6 write-up, 8 GB not measured, no scripts', () => {
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  const line = demos.find((d) => d.repo === 'site').status;
  const e2e = JSON.parse(readFileSync(join(root, 'data', 'e2e.json'), 'utf8'));
  const g = e2e.groups.find((x) => x.restart === false);
  assert.match(line, /^Sprint 7 \(20 Nov 2026\): Working: a Start here page that links the six demos and the four quick starts that need no model download/);
  assert.ok(line.includes(`the size of dockit's download (about ${Math.round(g.storage_usage_bytes.median / 1e6)} MB, read from the stored size in the benchmark data) stated before its link`));
  assert.match(line, /a section of the benchmarks page for dockit's emulated Windows run \(a GitHub-hosted virtual machine, never a laptop\), built only from dockit's committed rows: a capped leg reads limit proven in force only when the system's read-back equals what was set and a commit above the limit was refused, each leg says whether commits were refused while the benchmark ran, the 2 GiB control is reported as a control and in no figure, and no row fills an 8 GB laptop cell/);
  assert.doesNotMatch(line, /does not exist yet|pending/);
  assert.ok(line.includes(`a median of ${Math.round(g.process_rss_peak_bytes.median / 1048576).toLocaleString('en-US')} MiB, still short of the 5,120 MiB target`));
  assert.match(line, /the Sprint 6 write-up is finished as an unlisted draft and a Sprint 7 skeleton exists/);
  assert.match(line, /No scripts\. Not yet: 8 GB figures \(not measured on 8 GB\), a Windows laptop measurement \(the emulated Windows run is not one\)/);
  assert.doesNotMatch(line, /\bmet\b|audited|compliant/i);
});

test('every WebLLM mention in the site reads not yet (cut from Sprint 4) or cut, and nothing implies the spec is live on GitHub', () => {
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  for (const d of demos) {
    const sprint4 = d.status.startsWith('Sprint 4');
    for (const m of d.status.matchAll(/WebLLM[^.;]*/g)) {
      if (sprint4) assert.match(m[0], /cut from Sprint 4|cut to Sprint 5/, `${d.repo}: '${m[0]}' must read cut`);
    }
    assert.doesNotMatch(d.status, /live on GitHub|published on GitHub|public on GitHub/i, `${d.repo}: implies the spec is live`);
    if (/manifest spec/i.test(d.status)) {
      assert.ok(d.status.includes("manifest spec v0.1 published in runtime/spec (committed; public after the owner's push)"), `${d.repo}: spec wording`);
    }
  }
  const { out } = buildToTemp();
  for (const file of walk(out).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(file, 'utf8').replace(/\s+/g, ' ');
    assert.doesNotMatch(html, /spec[^.]{0,60}\b(is|are) (now )?(live|public|published) on GitHub/i, `${file}: spec implied live`);
  }
});

test('gap 3 (TD-11): no site page, write-up or data file pitches cheaper inference, savings on inference or a cost per token', () => {
  const FORBIDDEN = [/cheaper inference/i, /save on inference/i, /lower inference cost/i, /cost per token/i, /DPDP\/GDPR-ready/i, /compliance export/i];
  const { out } = buildToTemp();
  const files = [
    ...walk(out).filter((f) => f.endsWith('.html')),
    ...walk(join(root, 'src', 'pages')),
    ...walk(join(root, 'writeups')),
    ...walk(join(root, 'data')),
  ];
  assert.ok(files.length > 15);
  for (const file of files) {
    const text = readFileSync(file, 'utf8').replace(/&#39;|&apos;/g, "'");
    for (const re of FORBIDDEN) assert.doesNotMatch(text, re, `${file} matches ${re}`);
  }
});

test('site README and CHANGELOG carry a Sprint 4 entry and make no AIBOM, DPDP or RBI compliance claim', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /Sprint 4/);
  assert.match(readme, /Sprint 4/);
  for (const [name, text] of [['README.md', readme], ['CHANGELOG.md', changelog]]) {
    for (const line of text.split('\n')) {
      if (/AIBOM|model[- ]inventory|\bDPDP\b|\bRBI\b/.test(line)) {
        assert.match(line, /\b(no|not|never|nothing|without)\b/i, `${name}: a regulatory term without a negation: ${line}`);
      }
      if (/complian/i.test(line)) assert.match(line, /\b(no|not|never|nothing|without)\b/i, `${name}: 'complian' without a negation: ${line}`);
    }
  }
});

// ---- Sprint 4 fix round 1 (T1-S4-03): demos.json lines and home rows follow the dev status texts ----

test('demos.json: the six lines equal the status-line files of the lanes for the current sprint (committed fixtures of evidence/sprint-<SPRINT>, TD-78)', () => {
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  const line = (r) => demos.find((d) => d.repo === r)?.status ?? '';
  assert.equal(SPRINT, 7, 'one SPRINT constant names the sprint whose evidence folder the demo-status checks read');
  for (const r of ['runtime', 'localdata', 'pagetriage', 'glyphsift', 'dockit', 'site']) assert.match(line(r), /^Sprint \d \(\d{1,2} Nov 2026\): /, `${r}: not a sprint status line`);
  for (const [r, file] of Object.entries(STATUS_SOURCES)) {
    assert.equal(line(r), readSibling('evidence', `sprint-${SPRINT}/${file}`).trim(), `${r}: differs from evidence/sprint-${SPRINT}/${file}`);
  }
  assert.match(line('runtime'), /WebLLM \(cut\)/);
  for (const r of ['runtime', 'localdata', 'pagetriage', 'glyphsift']) assert.doesNotMatch(line(r), /carried to Sprint 4|lands in Sprint 4|reports not_implemented|an expected-id check\.$/, `${r}: stale`);
});

test('sync-demo-status: the default source is evidence/sprint-<SPRINT> (TD-78), writtenOn follows the date inside the line, and --check on the committed fixtures finds nothing to write', () => {
  assert.equal(dateOfLine('Sprint 6 (19 Nov 2026): Working: x. Not yet: y.'), '2026-11-19');
  assert.equal(dateOfLine('Sprint 5 (3 Jan 2027): Working: x.'), '2027-01-03');
  assert.throws(() => dateOfLine('Sprint 6 (31 Foo 2026): x'), /date/);
  assert.throws(() => dateOfLine('no sprint here'), /status line/);
  // the default folder is the workspace evidence folder of the current sprint when it exists, else the lane scratch folder of that sprint
  const d = defaultFrom({ exists: (p) => p.endsWith(`evidence${sep}sprint-${SPRINT}`) });
  assert.ok(d.endsWith(`evidence${sep}sprint-${SPRINT}`), d);
  const s = defaultFrom({ exists: () => false });
  assert.ok(s.endsWith(`sprint-${SPRINT}`) && !s.includes('evidence'), s);
  // the committed fixtures are the lane files as the architect copies them: demos.json is up to date against them
  const from = join(root, 'test', 'fixtures', 'siblings', 'evidence', `sprint-${SPRINT}`);
  assert.equal(syncDemoStatus(from, { write: false }).changed, false, 'data/demos.json differs from the committed sprint status-line fixtures');
});

// BUG-T1-S5-05: README section 1 is the status line, equal to this repository's line in data/demos.json, with the narrative after it.
test('site README: section 1 (Status) opens with the site status line of data/demos.json, verbatim, and the narrative follows', () => {
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  const siteLine = demos.find((d) => d.repo === 'site').status;
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const m = /^## Status\n\n([^\n]+)\n\n([^\n]+)/m.exec(readme);
  assert.ok(m, 'README.md has no "## Status" section that starts with a one-line paragraph');
  assert.equal(m[1], siteLine, 'the first paragraph of ## Status must be the site line of data/demos.json, verbatim');
  assert.ok(m[2].length > 80, 'the narrative follows the status line');
  // it is the first section after the title block: nothing numbered or named before it except the introduction
  assert.ok(readme.indexOf('## Status') < readme.indexOf('## Install'), 'Status comes before Install');
  assert.equal([...readme.matchAll(/^## /gm)].map((x) => x.index)[0], readme.indexOf('## Status'), 'Status is the first section');
});

test('site README: the Sprint 4 state is stated as it is (pushed 15 Nov, runs red, live site still Sprint 2), not as "pending the owner\'s push"', () => {
  const flat = readFileSync(join(root, 'README.md'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(
    flat.includes(
      'pushed 15 Nov 2026 at 4bd3cb2; CI and pages at that head red: runs 43667716669 and 43667716681; the live site still shows Sprint 2; open until the owner pushes the Sprint 5 fix and reads green runs',
    ),
  );
  assert.doesNotMatch(flat, /CI on three OSes configured, pending the owner's push/);
  assert.doesNotMatch(flat.replace(/not (?:yet )?(?:green|read)/gi, ''), /CI (?:is )?green on (?:all )?three/i);
});

test('home page repository table: Sprint 7 statuses (runtime beta, localdata documents API and HNSW graph, glyphsift gate, dockit answering offline one model at a time), 8 GB not measured', () => {
  const html = readFileSync(join(root, 'src', 'pages', 'index.html'), 'utf8').replace(/\s+/g, ' ');
  const row = (n) => new RegExp(`<tr><td><a [^>]*>${n}</a></td>.*?</tr>`).exec(html)?.[0] ?? '';
  assert.match(row('runtime'), /Beta 0\.3\.0-beta\.2 on spec release 0\.6\.1 \(not tagged, not published, not tag-ready\)/);
  assert.doesNotMatch(row('runtime'), /0\.2\.0-alpha/);
  assert.match(row('localdata'), /0\.4\.0-alpha\.1/);
  assert.match(row('localdata'), /documents API \(putDocument, queryChunks\)/);
  assert.match(row('localdata'), /\(not measured on 8 GB\)/);
  assert.match(row('glyphsift'), /0\.1\.3/);
  assert.match(row('dockit'), /0\.4\.0-dev \(private, never published to a registry\): answers a question about a PDF offline with one small local model at a time; OCR: not yet; not measured on 8 GB/);
  assert.doesNotMatch(row('dockit'), /Skeleton|no document processing/);
});

// ---- Sprint 5 (D5-01): a lone checkout runs the whole suite; sibling reads go through committed fixtures ----

const SOURCE_JSON_FILE = join(root, 'test', 'fixtures', 'siblings', 'SOURCE.json');

test('lone checkout: this file reads no sibling folder or workspace evidence folder, and no test skips for an absent sibling', () => {
  const src = readFileSync(join(root, 'test', 'build.test.mjs'), 'utf8');
  // Patterns are assembled from pieces so this test does not match itself.
  const dotdot = ['\'', '..', '\''].join('');
  const forbidden = [
    [new RegExp(`join\\(root, ${dotdot}`), 'a path built from the parent folder of the repository'],
    [new RegExp(`${dotdot}, ${dotdot}evidence${dotdot}`), 'the workspace evidence folder'],
    [new RegExp(['(?<![A-Z_])SIB', 'LINGS\\b'].join('')), 'a sibling-root constant'],
    [new RegExp(['t\\.sk', 'ip\\('].join('')), 'a runtime skip'],
    [new RegExp(['\\{ sk', 'ip: '].join('')), 'a skip option'],
    [new RegExp(['process\\.env\\.(LANDED_JSON|DEMO_STATUS', '_SOURCES)'].join('')), 'an environment override that points outside the repository'],
    [new RegExp(['absent: skipped, ', 'never guessed'].join('')), 'an absence-guarded check'],
  ];
  for (const [re, what] of forbidden) assert.doesNotMatch(src, re, `build.test.mjs contains ${what}`);
  assert.equal(siblingMode() === 'live' || siblingMode() === 'fixture', true);
});

test('sibling fixtures: every SOURCE.json entry has its file, the recorded sha256, a full commit or null, and stays under 100 KB', () => {
  const src = JSON.parse(readFileSync(SOURCE_JSON_FILE, 'utf8'));
  assert.ok(src.files.length >= 30, `expected at least 30 recorded fixtures, found ${src.files.length}`);
  for (const repo of ['pagetriage', 'glyphsift', 'localdata', 'runtime', 'dockit', 'control-plane']) {
    assert.match(src.heads[repo], /^[0-9a-f]{40}$/, `${repo}: head`);
  }
  const seen = new Set();
  for (const f of src.files) {
    const id = `${f.repo}/${f.path}`;
    assert.ok(!seen.has(id), `${id}: listed twice`);
    seen.add(id);
    assert.ok(f.commit === null ? ['evidence', 'workspace'].includes(f.repo) || f.origin === 'working-tree' : /^[0-9a-f]{40}$/.test(f.commit), `${id}: commit`);
    assert.match(f.sha256, /^[0-9a-f]{64}$/);
    const file = join(root, 'test', 'fixtures', 'siblings', f.repo, ...f.path.split('/'));
    assert.ok(existsSync(file), `${id}: fixture file is missing`);
    // .gitattributes marks the folder -text so a Windows checkout keeps LF; line endings are normalised here as well, so a CRLF
    // conversion by a git client with autocrlf on can never read as a changed fixture.
    const bytes = Buffer.from(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), f.sha256, `${id}: sha256 differs from SOURCE.json`);
    assert.equal(bytes.length, f.bytes, `${id}: size`);
    assert.ok(bytes.length <= 100 * 1024, `${id}: over 100 KB`);
  }
  // No fixture can be picked up as a test file by `node --test`, and nothing else sits in the folder.
  const onDisk = walk(join(root, 'test', 'fixtures', 'siblings'))
    .map((f) => f.slice(join(root, 'test', 'fixtures', 'siblings').length + 1).split(sep).join('/'))
    .filter((f) => f !== 'SOURCE.json')
    .sort();
  assert.deepEqual(onDisk, [...seen].sort(), 'files on disk and files in SOURCE.json differ');
  assert.equal(onDisk.some((f) => /\.(c|m)?js$/.test(f)), false, 'a fixture would be run by node --test');
});

test('npm run test:siblings exists, and neither ci.yml nor pages.yml runs it; both run the same build and node --test', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['test:siblings'] ?? '', /siblings\.local\.test\.mjs/);
  assert.ok(existsSync(join(root, 'test', 'siblings.local.test.mjs')));
  for (const wf of ['ci.yml', 'pages.yml']) {
    const text = readFileSync(join(root, '.github', 'workflows', wf), 'utf8');
    assert.doesNotMatch(text, /test:siblings|siblings\.local|SITE_SIBLINGS/, `${wf} must not run the local-only sibling check`);
    assert.match(text, /^\s+- run: node scripts\/build\.mjs$/m, `${wf}: build step`);
    assert.match(text, /^\s+- run: node --test$/m, `${wf}: test step`);
  }
});

// ---- Sprint 5 (D5-02): the public benchmark page, built from committed data only ----

const E2E_FIXTURE = join(root, 'test', 'fixtures', 'e2e.csv');
const E2E_Q_FIXTURE = join(root, 'test', 'fixtures', 'e2e-questions.csv');
const e2eImporter = () => import('../scripts/import-dockit-bench.mjs');
const REAL_E2E = () => readSibling('dockit', 'docs/benchmarks/e2e.csv');
const REAL_E2E_Q = () => readSibling('dockit', 'docs/benchmarks/e2e-questions.csv');

test('e2e importer: medians and worst per (machine, restart), and the question-set result for the first run and over all runs', async () => {
  const { buildE2e, median } = await e2eImporter();
  const d = buildE2e(readFileSync(E2E_FIXTURE, 'utf8'), readFileSync(E2E_Q_FIXTURE, 'utf8'));
  assert.equal(d.groups.length, 2);
  const [cold, restart] = d.groups;
  assert.deepEqual([cold.machine, cold.restart, cold.runs], ['synthetic fixture', false, 3]);
  assert.deepEqual(cold.first_token_ms, { median: 1100, worst: 1200 });
  assert.deepEqual(cold.total_ms, { median: 5500, worst: 6000 });
  assert.deepEqual(cold.process_rss_peak_bytes, { median: 2100000000, worst: 2200000000 });
  assert.deepEqual(cold.js_heap_peak_bytes, { median: 31000000, worst: 32000000 });
  assert.deepEqual(cold.wasm_memory_peak_bytes, { median: 800000000, worst: 800000000 });
  assert.equal(cold.requests_after_offline.max, 0);
  assert.deepEqual([restart.restart, restart.runs], [true, 1]);
  assert.deepEqual(restart.first_token_ms, { median: 1500, worst: 1500 });
  assert.equal(cold.laptop8gb, 'not measured on 8 GB');
  // 4 runs x 6 answerable questions = 24. Two rows are not joint-correct: the cited page is wrong (run 2, q4) and the model refused (run 3, q6: no citation,
  // so no cited page, although the top-ranked passage was on the right page). Joint: 22 of 24; the first run is 6 of 6; q7 has no answer and is refused in all 4 runs
  assert.deepEqual(d.questions.firstRun, { correct: 6, of: 6, run: 1 });
  assert.deepEqual(d.questions.all, { correct: 22, of: 24, runs: 4 });
  assert.deepEqual(d.questions.unanswerable, { refused: 4, of: 4 });
  assert.match(d.questions.selection, /none/);
  const q4 = d.questions.perQuestion.find((x) => x.qid === 'q4');
  assert.deepEqual([q4.runs, q4.answerOk, q4.pageOk, q4.topRetrievedOk], [4, 4, 3, 3]);
  // BUG-T1-S5-R2-05 (TD-59): a refused answer is never credited with a correct source page; retrieval is its own count
  const q6 = d.questions.perQuestion.find((x) => x.qid === 'q6');
  assert.deepEqual([q6.runs, q6.answerOk, q6.pageOk, q6.topRetrievedOk], [4, 3, 3, 4]);
  assert.deepEqual(d.questions.citedPage, { ok: 22, of: 24 });
  assert.deepEqual(d.questions.topRetrieved, { ok: 23, of: 24 });
  assert.equal(d.questions.perQuestion.find((x) => x.qid === 'q7').answerable, false);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 3, 'an even count averages the middle two and rounds');
  assert.equal(median([]), null);
});

test('e2e importer: records the CSV hashes and the commit, and a figure missing from any run of a group is reported as not measured, never a median of the rest', async () => {
  const { buildE2e } = await e2eImporter();
  const text = readFileSync(E2E_FIXTURE, 'utf8');
  const q = readFileSync(E2E_Q_FIXTURE, 'utf8');
  const d = buildE2e(text, q);
  assert.equal(d.source.csvSha256, createHash('sha256').update(text).digest('hex'));
  assert.equal(d.source.questionsCsvSha256, createHash('sha256').update(q).digest('hex'));
  assert.equal(d.source.commit, 'abc1234-dirty');
  assert.equal(d.source.rows, 4);
  const lines = text.split('\n');
  const cols = lines[0].split(',');
  const i = cols.indexOf('wasm_memory_peak_bytes');
  const cut = lines.map((l, n) => (n === 2 ? l.split(',').map((c, k) => (k === i ? '' : c)).join(',') : l)).join('\n');
  assert.equal(buildE2e(cut, q).groups[0].wasm_memory_peak_bytes, null);
});

test('e2e importer: refuses a missing column, a non-number and a missing request count instead of showing a wrong figure', async () => {
  const { buildE2e } = await e2eImporter();
  const text = readFileSync(E2E_FIXTURE, 'utf8');
  const q = readFileSync(E2E_Q_FIXTURE, 'utf8');
  assert.throws(() => buildE2e(text.replace('process_rss_peak_bytes', 'rss'), q), /process_rss_peak_bytes/);
  assert.throws(() => buildE2e(text.replace(',2000000000,', ',lots,'), q), /not a number/);
  assert.throws(() => buildE2e(text, q.replace('answer_ok', 'ok')), /answer_ok/);
  assert.throws(() => buildE2e('date\n', q), /column|rows/);
});

// BUG-T1-S5-07: both CSVs carry a laptop_8gb column that reads 'not measured on 8 GB' on every row; the importer requires it and shows it.
test('e2e importer: requires the laptop_8gb column in both CSVs and refuses a row that does not read not measured on 8 GB', async () => {
  const { buildE2e, NOT_MEASURED_8GB } = await e2eImporter();
  const text = readFileSync(E2E_FIXTURE, 'utf8');
  const q = readFileSync(E2E_Q_FIXTURE, 'utf8');
  assert.equal(NOT_MEASURED_8GB, 'not measured on 8 GB');
  assert.throws(() => buildE2e(text.replace('laptop_8gb', 'laptop'), q), /laptop_8gb/);
  assert.throws(() => buildE2e(text, q.replace('laptop_8gb', 'laptop')), /laptop_8gb/);
  assert.throws(() => buildE2e(text.replace('not measured on 8 GB', 'measured on 8 GB'), q), /laptop_8gb.*not measured on 8 GB/);
  assert.throws(() => buildE2e(text.replace('not measured on 8 GB', ''), q), /laptop_8gb/);
  assert.throws(() => buildE2e(text, q.replace('not measured on 8 GB', '12 GB')), /laptop_8gb/);
  const d = buildE2e(text, q);
  for (const g of d.groups) assert.equal(g.laptop8gb, 'not measured on 8 GB');
  for (const x of d.questions.perQuestion) assert.equal(x.laptop8gb, 'not measured on 8 GB');
});

test('the real dockit CSVs (committed copies) read not measured on 8 GB on every row', () => {
  for (const [name, text] of [['e2e.csv', REAL_E2E()], ['e2e-questions.csv', REAL_E2E_Q()]]) {
    const lines = text.trim().split('\n');
    const col = lines[0].split(',').indexOf('laptop_8gb');
    assert.ok(col >= 0, `${name}: no laptop_8gb column`);
    for (const [i, l] of lines.slice(1).entries()) assert.equal(l.split(',')[col], 'not measured on 8 GB', `${name} row ${i + 1}`);
  }
});

test('e2e importer: --check recomputes and exits non-zero when the output differs; a second run changes nothing', async () => {
  const { importE2e } = await e2eImporter();
  const tmp = mkdtempSync(join(tmpdir(), 'amlabs-site-e2e-'));
  const out = join(tmp, 'e2e.json');
  const first = importE2e({ from: E2E_FIXTURE, questions: E2E_Q_FIXTURE, out });
  assert.equal(first.changed, true);
  const again = importE2e({ from: E2E_FIXTURE, questions: E2E_Q_FIXTURE, out });
  assert.equal(again.changed, false);
  writeFileSync(out, readFileSync(out, 'utf8').replace('"median": 1100', '"median": 1101'));
  assert.equal(importE2e({ from: E2E_FIXTURE, questions: E2E_Q_FIXTURE, out, write: false }).changed, true);
});

const REAL_BASELINE = () => readSibling('dockit', 'docs/benchmarks/e2e-s6-baseline.csv');
const REAL_BASELINE_Q = () => readSibling('dockit', 'docs/benchmarks/e2e-questions-s6-baseline.csv');

test('data/e2e.json equals the importer output for the committed copies of dockit\'s real CSVs, before and after (no figure is typed by hand)', async () => {
  const { buildE2eWithBaseline } = await e2eImporter();
  const committed = JSON.parse(readFileSync(join(root, 'data', 'e2e.json'), 'utf8'));
  const fresh = buildE2eWithBaseline({ after: [REAL_E2E(), REAL_E2E_Q()], baseline: [REAL_BASELINE(), REAL_BASELINE_Q()] });
  assert.deepEqual(committed, fresh, 'run: node scripts/import-dockit-bench.mjs --from ../dockit/docs/benchmarks/e2e.csv --questions ../dockit/docs/benchmarks/e2e-questions.csv --baseline-from ../dockit/docs/benchmarks/e2e-s6-baseline.csv --baseline-questions ../dockit/docs/benchmarks/e2e-questions-s6-baseline.csv; then node scripts/make-sibling-fixtures.mjs');
  for (const set of [committed, committed.baseline]) {
    assert.ok(set.groups.some((g) => g.restart === false && g.runs >= 5), 'at least five runs in one session');
    assert.ok(set.groups.some((g) => g.restart === true), 'a run after a Chrome restart');
    for (const g of set.groups) assert.equal(g.requests_after_offline.max, 0, 'no request after offline');
  }
});

// BUG-T1-S6-04: one rounding rule. The fall and its percentage are recomputed here from the dockit CSVs (exact medians, then rounded) and must equal the rendered text
test('the memory page text states the fall computed from the exact CSV medians (not from two rounded medians), and what the median is', async () => {
  const { renderMemory } = await import('../scripts/build.mjs');
  const medianRss = (text) => {
    const [head, ...lines] = text.trim().split('\n');
    const h = head.split(',');
    const v = lines.map((l) => l.split(',')).filter((c) => c[h.indexOf('restart')] !== 'true').map((c) => Number(c[h.indexOf('process_rss_peak_bytes')])).sort((a, b) => a - b);
    return { n: v.length, median: v.length % 2 ? v[v.length >> 1] : (v[(v.length >> 1) - 1] + v[v.length >> 1]) / 2 };
  };
  const b = medianRss(REAL_BASELINE());
  const a = medianRss(REAL_E2E());
  const fall = (b.median - a.median) / 1048576;
  const pct = ((fall / (b.median / 1048576)) * 100).toFixed(1);
  const e2e = JSON.parse(readFileSync(join(root, 'data', 'e2e.json'), 'utf8'));
  const text = renderMemory(e2e).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(text.includes(`a fall of ${Math.round(fall).toLocaleString('en-US')} MiB (${pct} percent)`), `fall ${fall} (${pct}) not in the page text`);
  assert.ok(text.includes(`median of the ${a.n} in-session runs`), 'the 5-run definition of the median is stated');
  assert.ok(text.includes('the run after a Chrome restart is shown separately'));
  assert.match(text, /computed from the exact medians \(the exact fall is [\d,]+\.\d MiB, shown as [\d,]+\) and then rounded/);
});

// ---- Sprint 6 (D5-08, B1): the memory hardening table, before and after, and the flat-against-HNSW table, from committed data only ----

/** The synthetic fixture with its memory scaled, as a stand-in for a baseline: every other column is the fixture's own. */
const scaledCsv = (text, factor) => {
  const [head, ...lines] = text.trim().split('\n');
  const col = head.split(',').indexOf('process_rss_peak_bytes');
  return `${[head, ...lines.map((l) => { const c = l.split(','); c[col] = String(Math.round(Number(c[col]) * factor)); return c.join(','); })].join('\n')}\n`;
};

test('e2e importer: per-question timing over every question row, and a baseline set built the same way next to the after set, with the TD-66 target as data', async () => {
  const { buildE2e, buildE2eWithBaseline, MEMORY_TARGET } = await e2eImporter();
  const after = [readFileSync(E2E_FIXTURE, 'utf8'), readFileSync(E2E_Q_FIXTURE, 'utf8')];
  const baseline = [scaledCsv(after[0], 1.25), after[1]];
  const one = buildE2e(...after);
  assert.ok(one.questions.timing, 'questions.timing exists');
  assert.equal(one.questions.timing.rows, 28);
  assert.deepEqual(Object.keys(one.questions.timing).sort(), ['first_token_ms', 'rows', 'total_ms']);
  const d = buildE2eWithBaseline({ after, baseline });
  assert.deepEqual(d.groups, one.groups, 'the after set is the top level, as before');
  assert.equal(d.baseline.groups[0].process_rss_peak_bytes.median, Math.round(d.groups[0].process_rss_peak_bytes.median * 1.25));
  assert.deepEqual(d.baseline.questions, buildE2e(...baseline).questions);
  assert.deepEqual(MEMORY_TARGET, { decision: 'TD-66', rssMedianMiB: 5120, totalMedianMs: 12500, questionFirstRunMin: 4, questionAllMin: 24 });
  assert.deepEqual(d.target, MEMORY_TARGET);
  assert.match(d.baseline.source.csv, /e2e-s6-baseline\.csv$/);
  assert.match(d.source.csv, /e2e\.csv$/);
  // a baseline that was not written by bench:e2e (no 8 GB phrase) is refused like any other file
  assert.throws(() => buildE2eWithBaseline({ after, baseline: [baseline[0].replaceAll('not measured on 8 GB', 'x'), baseline[1]] }), /laptop_8gb/);
});

test('workspace fixtures are small excerpts: no file over 4 KB, no narrative about the lawyer review, trademark searches or owner decisions (BUG-T3-S6-R2-07)', () => {
  const dir = join(root, 'test', 'fixtures', 'siblings', 'workspace');
  const names = readdirSync(dir);
  assert.ok(names.length >= 2, 'the workspace fixtures exist');
  for (const name of names) {
    const file = join(dir, name);
    const size = statSync(file).size;
    assert.ok(size <= 4096, `${name} is ${size} bytes: a public fixture is an excerpt of at most 4 KB, never a whole internal report`);
    assert.doesNotMatch(readFileSync(file, 'utf8'), /lawyer|trademark|owner decision/i, `${name} carries internal narrative`);
  }
});

test('the memory section says peaks are comparable only on a quiet host and that the fall comes from the exact medians (BUG-T1-S6-05)', () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'benchmarks', 'index.html'), 'utf8');
  const section = /<h2 id="memory-hardening">[\s\S]*?(?=<h2 id="vector-search">|<h2 id="reference-machine">|<h2>Reference machine<\/h2>)/.exec(html)?.[0] ?? '';
  assert.match(section, /Process-tree peaks are comparable only between runs on a quiet host/);
  assert.match(section, /The stated figure is the quiet-host one/);
  const e2e = JSON.parse(readFileSync(join(root, 'data', 'e2e.json'), 'utf8'));
  const exact = e2e.baseline.groups.find((g) => g.restart === false).process_rss_peak_bytes.median / 1048576 - e2e.groups.find((g) => g.restart === false).process_rss_peak_bytes.median / 1048576;
  assert.ok(section.includes(`computed from the exact medians (the exact fall is ${exact.toFixed(1)} MiB, shown as ${Math.round(exact).toLocaleString('en-US')})`), 'the exact fall is named');
});

test('the built benchmarks page has a Memory hardening (Sprint 6) table: before and after from data/e2e.json only, the target outcome computed, the 8 GB column reads not measured on 8 GB', () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'benchmarks', 'index.html'), 'utf8');
  const section = /<h2 id="memory-hardening">[\s\S]*?(?=<h2 id="vector-search">|<h2 id="reference-machine">|<h2>Reference machine<\/h2>)/.exec(html)?.[0] ?? '';
  assert.ok(section.length > 500, 'the memory hardening section is missing');
  const e2e = JSON.parse(readFileSync(join(root, 'data', 'e2e.json'), 'utf8'));
  assert.ok(e2e.baseline && e2e.target, 'data/e2e.json carries the baseline and the target');
  assert.match(section, /<h2 id="memory-hardening">Memory hardening \(Sprint 6\)<\/h2>/);
  for (const th of ['Peak memory: Chrome process tree', 'Time to first token', 'Total, first question', 'Per-question total', 'Question set', 'Requests after offline', '8 GB laptop']) assert.ok(section.includes(`<th>${th}`), `column ${th} missing`);
  const rows = [...section.matchAll(/<tr><td>(Before|After)[^<]*<\/td>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  assert.equal(rows.length, 2, 'one row before and one after');
  for (const r of rows) assert.ok(r.includes('<td>not measured on 8 GB</td>'), `the 8 GB cell of ${r.slice(0, 30)}`);
  const sess = (set) => set.groups.find((g) => g.restart === false);
  const mib = (b) => `${Math.round(b / 1048576).toLocaleString('en-US')} MiB`;
  for (const [row, set] of [[rows[0], e2e.baseline], [rows[1], e2e]]) {
    const g = sess(set);
    assert.ok(row.includes(`${mib(g.process_rss_peak_bytes.median)} / ${mib(g.process_rss_peak_bytes.worst)}`), 'the peak memory cell is the data');
    assert.ok(row.includes(`${g.first_token_ms.median.toLocaleString('en-US')} ms / ${g.first_token_ms.worst.toLocaleString('en-US')} ms`));
    assert.ok(row.includes(`${set.questions.firstRun.correct} of ${set.questions.firstRun.of} first run, ${set.questions.all.correct} of ${set.questions.all.of} over all runs`));
    assert.ok(row.includes(`${set.questions.timing.total_ms.median.toLocaleString('en-US')} ms`), 'the per-question total median');
  }
  // the target is stated as a number and its outcome is computed from the data, in words that are not "met"
  const after = sess(e2e).process_rss_peak_bytes.median / 1048576;
  const reached = after <= e2e.target.rssMedianMiB;
  assert.ok(section.includes(`The target stated before measuring (TD-66) was a median peak of at most ${e2e.target.rssMedianMiB.toLocaleString('en-US')} MiB`));
  assert.ok(section.includes(reached ? 'The target was reached' : 'The target was not reached'), 'the outcome follows the data');
  assert.ok(section.includes(`${e2e.target.totalMedianMs.toLocaleString('en-US')} ms`), 'the time guard is stated');
  assert.doesNotMatch(section, /\bmet\b/);
  // every number on the section is a value of the data, a conversion of one, a difference of two, or a fixed word-number
  const allowed = jsonNumbers(e2e);
  const prose = section.replace(/<code>[\s\S]*?<\/code>/g, ' ').replace(/Chrome\/[\d.]+/g, ' ').replace(/TD-\d+/g, ' ');
  const derived = new Set([...allowed].filter((n) => /^\d+$/.test(n) && n.length > 5).map((n) => String(Math.round(Number(n) / 1048576))));
  const bm = sess(e2e.baseline).process_rss_peak_bytes.median / 1048576;
  // BUG-T1-S6-04: the fall is taken from the exact medians, then rounded
  const diff = Math.round(bm - after);
  const pct = (((bm - after) / bm) * 100).toFixed(1);
  const FIXED = new Set(['8', '7', '6', '1', '3', '48', '5', '256', '1.7', '2', '4', '24', '36', String(Math.abs(diff)), (bm - after).toFixed(1), pct, pct.replace(/\.0$/, ''), '5120', '12500']);
  const stray = numbersIn(prose).filter((n) => !allowed.has(n) && !derived.has(n) && !FIXED.has(n));
  assert.deepEqual(stray, [], `numbers in the memory section that are not in data/e2e.json: ${stray.join(', ')}`);
  assert.doesNotMatch(section, /cheaper|cost per|inference cost|saves? money|savings|compliance|compliant|DPDP|RBI|regulator|free RAM/i);
});

function numbersIn(html) {
  const text = html.replace(/<[^>]+>/g, ' ');
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replaceAll(',', ''));
}
function jsonNumbers(value, acc = new Set()) {
  if (typeof value === 'number') acc.add(String(value));
  else if (typeof value === 'string') for (const m of value.matchAll(/\d[\d.]*/g)) acc.add(m[0]);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) jsonNumbers(v, acc);
  return acc;
}

test('the built benchmarks page has the dockit section: every number in it is in data/e2e.json, the 8 GB column reads not measured on 8 GB, peak memory is the process figure', () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'benchmarks', 'index.html'), 'utf8');
  const section = /<h2 id="dockit-e2e">[\s\S]*?(?=<h2 id="memory-hardening">|<h2 id="reference-machine">|<h2>Reference machine<\/h2>)/.exec(html)?.[0] ?? '';
  assert.ok(section.length > 500, 'dockit section missing');
  const e2e = JSON.parse(readFileSync(join(root, 'data', 'e2e.json'), 'utf8'));
  const allowed = jsonNumbers(e2e);
  // identifiers in code elements (hash prefixes, commit) and the Sprint number are not figures; the 8 GB, the question counts of the set (7, 6) and run numbers of the prose are allowed
  const prose = section.replace(/<code>[\s\S]*?<\/code>/g, ' ').replace(/Chrome\/[\d.]+/g, ' ');
  // 256 is in 'sha256'; 1.7 is the pilot model's name (Qwen3-1.7B); the rest are the question counts, the model and machine names
  const FIXED = new Set(['8', '7', '6', '1', '3', '48', '5', '256', '1.7']);
  const MiB = (n) => String(Math.round(Number(n) / 1048576));
  const derived = new Set([...allowed].filter((n) => /^\d+$/.test(n) && n.length > 5).map(MiB));
  const stray = numbersIn(prose).filter((n) => !allowed.has(n) && !derived.has(n) && !FIXED.has(n));
  assert.deepEqual(stray, [], `numbers on the page that are not in data/e2e.json: ${stray.join(', ')}`);
  assert.match(section, /<th>8 GB laptop<\/th>/);
  // one cell per run group in the run table and one per answerable question in the question table
  assert.equal([...section.matchAll(/<td>not measured on 8 GB<\/td>/g)].length, e2e.groups.length + e2e.questions.perQuestion.filter((x) => x.answerable).length);
  assert.equal([...section.matchAll(/<th>8 GB laptop<\/th>/g)].length, 2, 'both tables have the 8 GB column');
  assert.match(section, /Peak memory: Chrome process tree, summed resident size/);
  assert.match(section, /JS heap peak, main thread/);
  assert.match(section, /WebAssembly memory peak, workers/);
  for (const g of e2e.groups) assert.ok(section.includes(esc2(g.machine)) && section.includes('npm run bench:e2e'), 'every row names its machine and command');
  assert.ok(section.includes(`<strong>${e2e.questions.firstRun.correct} of ${e2e.questions.firstRun.of}</strong> correct with the correct source page`));
  assert.ok(section.includes(`<strong>${e2e.questions.all.correct} of ${e2e.questions.all.of}</strong>`));
});
const esc2 = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

test('the benchmarks page: done-when line, the seven limitations, no inference-cost or regulatory wording, and Sprint 5 is never called met', () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'benchmarks', 'index.html'), 'utf8');
  const flat = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(flat.includes('build done on Apple M5 Pro 48 GB; 8 GB Windows done-when NOT met (owner runbook step 5)'));
  const section = /<h3>Limitations<\/h3>[\s\S]*?<\/ul>/.exec(html)?.[0] ?? '';
  for (const phrase of ['Text-layer PDFs only', 'OCR is not yet supported', 'Qwen3-0.6B', 'not the pilot model', 'Single-threaded WebAssembly', 'The origin is shared', 'synthetic English policy', 'Hindi answer quality is not measured', 'Not measured on 8 GB']) {
    assert.ok(section.includes(phrase), `limitation missing: ${phrase}`);
  }
  assert.doesNotMatch(flat, /\bmet\b(?<!NOT met)/, "nothing may say a Sprint 5 done-when is met");
  assert.doesNotMatch(flat, /cheaper|cost per|inference cost|saves? money|savings|compliance|compliant|DPDP|RBI|regulator/i);
  assert.doesNotMatch(html, /<script/i);
});

test('the benchmarks page is linked from the nav and from the home page repository table', () => {
  const { out } = buildToTemp();
  const home = readFileSync(join(out, 'index.html'), 'utf8');
  assert.match(home, /<a href="benchmarks\/"[^>]*>Benchmarks<\/a>/);
  const bench = readFileSync(join(out, 'benchmarks', 'index.html'), 'utf8');
  assert.match(bench, /<a href="\.\.\/benchmarks\/"[^>]*aria-current="page"[^>]*>Benchmarks<\/a>|aria-current="page"[^>]*>Benchmarks</);
});

// ---- Sprint 6 (D5-08, B2): flat against HNSW at 100,000 x 384, from localdata's committed ann.csv only (TD-76) ----

const ANN_FIXTURE = join(root, 'test', 'fixtures', 'ann.csv');
const annImporter = () => import('../scripts/import-localdata-bench.mjs');
const REAL_ANN = () => readSibling('localdata', 'docs/benchmarks/ann.csv');

test('ann importer: one group per (data, index, ef), median and worst of its runs, the TD-65 recall target as data, and the 8 GB column enforced', async () => {
  const { buildAnn, ANN_TARGET } = await annImporter();
  const d = buildAnn(readFileSync(ANN_FIXTURE, 'utf8'));
  assert.equal(d.spec, 'airplanemode.site.ann/1');
  assert.equal(d.source.csv, 'docs/benchmarks/ann.csv');
  assert.match(d.source.csvSha256, /^[0-9a-f]{64}$/);
  assert.equal(d.source.rows, 12);
  assert.deepEqual(ANN_TARGET, { decision: 'TD-65', recallAtTenMin: 0.9, ef: 128 });
  assert.deepEqual(d.target, ANN_TARGET);
  assert.deepEqual(d.groups.map((g) => [g.data, g.index, g.ef, g.runs]), [
    ['clustered', 'flat', null, 3],
    ['clustered', 'hnsw', 32, 3],
    ['clustered', 'hnsw', 64, 3],
    ['clustered', 'hnsw', 128, 3],
  ]);
  const flat = d.groups[0];
  assert.deepEqual(flat.build_ms, { median: 1100, worst: 1200 });
  assert.deepEqual(flat.query_p50_ms, { median: 4, worst: 4.2 });
  assert.deepEqual(flat.query_p95_ms, { median: 4.5, worst: 4.6 });
  assert.deepEqual(flat.recall_at_10, { median: 1, worst: 1 });
  assert.equal(flat.ann_bytes.median, 0);
  const ef128 = d.groups[3];
  assert.deepEqual(ef128.build_ms, { median: 41000, worst: 42000 });
  assert.deepEqual(ef128.recall_at_10, { median: 1, worst: 1 });
  assert.equal(ef128.ann_bytes.median, 10000000);
  assert.deepEqual([flat.m, ef128.m, ef128.ef_construction], [null, 16, 200]);
  assert.equal(ef128.eight_gb, 'not measured on 8 GB');
  assert.equal(ef128.machine, 'synthetic fixture');
  assert.equal(ef128.command, 'npm run bench:ann');
  const text = readFileSync(ANN_FIXTURE, 'utf8');
  assert.throws(() => buildAnn(text.replaceAll('not measured on 8 GB', 'x')), /eight_gb/);
  assert.throws(() => buildAnn(text.replace(',eight_gb\n', ',nothing\n')), /eight_gb/);
  assert.throws(() => buildAnn(text.replace('recall_at_10', 'recall')), /recall_at_10/);
  assert.throws(() => buildAnn(text.split('\n')[0]), /no rows/);
});

test('data/ann.json equals the importer output for the committed copy of localdata\'s real ann.csv (no figure is typed by hand)', async () => {
  const { buildAnn } = await annImporter();
  const committed = JSON.parse(readFileSync(join(root, 'data', 'ann.json'), 'utf8'));
  assert.deepEqual(committed, buildAnn(REAL_ANN()), 'run: node scripts/import-localdata-bench.mjs --ann ../localdata/docs/benchmarks/ann.csv; then node scripts/make-sibling-fixtures.mjs');
  assert.ok(committed.groups.some((g) => g.index === 'flat') && committed.groups.some((g) => g.index === 'hnsw'), 'flat and HNSW rows');
  for (const g of committed.groups) {
    assert.equal(g.rows, 100000);
    assert.equal(g.dim, 384);
    assert.equal(g.eight_gb, 'not measured on 8 GB');
    assert.ok(g.machine && g.command, 'every row names its machine and command');
  }
});

test('the built benchmarks page has a flat-against-HNSW table: every figure from data/ann.json, the recall target outcome computed, the 8 GB column reads not measured on 8 GB', () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'benchmarks', 'index.html'), 'utf8');
  const section = /<h2 id="vector-search">[\s\S]*?(?=<h2 id="emulated-windows">|<h2 id="reference-machine">|<h2>Reference machine<\/h2>)/.exec(html)?.[0] ?? '';
  assert.ok(section.length > 500, 'the vector search section is missing');
  const ann = JSON.parse(readFileSync(join(root, 'data', 'ann.json'), 'utf8'));
  assert.match(section, /<h2 id="vector-search">Vector search: flat against HNSW at 100,000 x 384<\/h2>/);
  for (const th of ['Data', 'Index', 'Build', 'Query p50', 'Query p95', 'Recall@10', 'Index bytes', 'Graph bytes', 'JS heap peak', 'WebAssembly memory', 'Command', '8 GB laptop']) assert.ok(section.includes(`<th>${th}`), `column ${th} missing`);
  const rows = [...section.matchAll(/<tr><td>[^<]*<\/td><td>(?:flat|hnsw)[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  assert.equal(rows.length, ann.groups.length, 'one row per group');
  assert.equal([...section.matchAll(/<td>not measured on 8 GB<\/td>/g)].length, ann.groups.length);
  const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : String(Number(n.toFixed(4))));
  rows.forEach((row, i) => {
    const g = ann.groups[i];
    assert.ok(row.includes(esc2(g.machine)), 'the machine is named');
    assert.ok(row.includes(`${fmt(g.query_p50_ms.median)} ms / ${fmt(g.query_p50_ms.worst)} ms`), `p50 of ${g.index} ${g.ef}`);
    assert.ok(row.includes(`${fmt(g.query_p95_ms.median)} ms / ${fmt(g.query_p95_ms.worst)} ms`), `p95 of ${g.index} ${g.ef}`);
    assert.ok(row.includes(`${fmt(g.recall_at_10.median)} / ${fmt(g.recall_at_10.worst)}`), `recall of ${g.index} ${g.ef}`);
    assert.ok(row.includes(g.index === 'flat' ? '<td>flat</td>' : `<td>hnsw, ef ${g.ef}</td>`));
    assert.ok(row.includes(`<code>${esc2(g.command)}</code>`));
  });
  // the TD-65 floor is a number of the data and its outcome is computed, in words that are not "met"
  const target = ann.groups.find((g) => g.data === 'clustered' && g.index === 'hnsw' && g.ef === ann.target.ef);
  assert.ok(target, 'a clustered HNSW group at the target ef');
  const reached = target.recall_at_10.median >= ann.target.recallAtTenMin;
  assert.ok(section.includes(reached ? 'The recall target was reached' : 'The recall target was not reached'));
  assert.ok(section.includes(`recall@10 of at least ${ann.target.recallAtTenMin.toFixed(2)} at ef ${ann.target.ef}`));
  assert.doesNotMatch(section, /\bmet\b/);
  assert.match(section, /Quantisation, compaction and encryption at rest are not yet/);
  assert.doesNotMatch(section, /cheaper|cost per|inference cost|saves? money|savings|compliance|compliant|DPDP|RBI|regulator|free RAM/i);
  // every number is a value of the data, a MiB conversion of one, or a count that names the test (100,000 x 384, the ef values, the limits)
  const allowed = jsonNumbers(ann);
  const prose = section.replace(/<code>[\s\S]*?<\/code>/g, ' ').replace(/Chrome\/[\d.]+/g, ' ').replace(/TD-\d+/g, ' ').replace(/recall@10/g, ' ');
  // 256 is in 'sha256'; 50 and 95 are in the column names p50 and p95
  const FIXED = new Set(['100000', '384', '8', '10', '0.90', '0.9', '32', '64', '128', '16', '200', '2', '1', '256', '50', '95']);
  const derived = new Set([...allowed].filter((n) => /^\d+$/.test(n) && n.length > 5).map((n) => String(Math.round(Number(n) / 1048576))));
  const stray = numbersIn(prose).filter((n) => !allowed.has(n) && !derived.has(n) && !FIXED.has(n));
  assert.deepEqual(stray, [], `numbers in the vector search section that are not in data/ann.json: ${stray.join(', ')}`);
});

// ---- T3-S5-11: a public repository holds no home directory and no scratch path ----

// The two prefixes are built from parts so that this file does not contain them itself.
const HOME_PREFIX = ['/Users', '/'].join('');
const SCRATCH_PREFIX = ['/private', '/tmp', '/'].join('');
const ACCOUNT_NAME = ['tushar', 'patekar'].join('');

test('no committed file under site/ holds a home directory or a scratch path (outside node_modules, dist and .git)', () => {
  const files = walk(root).filter((f) => !f.split(sep).some((p) => ['node_modules', 'dist', '.git'].includes(p)));
  assert.ok(files.length > 50, 'the walk found the repository');
  const hits = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const p of [HOME_PREFIX, SCRATCH_PREFIX, ACCOUNT_NAME]) if (text.includes(p)) hits.push(`${f.slice(root.length + 1)} holds ${p}`);
  }
  assert.deepEqual(hits, []);
});

test('cutText redact "paths": the workspace, the projects folder, a scratch sprint folder and any other home path are replaced; everything else is kept', () => {
  const home = `${HOME_PREFIX}someone`;
  const src = [
    `RUN  v4.1.12 ${home}/Projects/airplane-mode-labs/runtime`,
    `wrote ${home}/Projects/test-results/x.json`,
    `evidence ${SCRATCH_PREFIX}airplanemode-team/sprint-3/D1/green.log and ${SCRATCH_PREFIX}airplanemode-team/sprint-4/T1/a.json`,
    `other ${home}/.cache/thing`,
    `drwxr-xr-x@  6 ${ACCOUNT_NAME}  staff  192 14 Nov 10:11 .`,
    'tests 58 pass 58 fail 0',
  ].join('\n');
  const out = cutText(src, { mode: 'whole', redact: 'paths' });
  assert.equal(
    out,
    [
      'RUN  v4.1.12 <workspace>/runtime',
      'wrote <projects>/test-results/x.json',
      'evidence <scratch>/sprint-3/D1/green.log and <scratch>/sprint-4/T1/a.json',
      'other <home>/.cache/thing',
      'drwxr-xr-x@  6 <user>  staff  192 14 Nov 10:11 .',
      'tests 58 pass 58 fail 0',
    ].join('\n'),
  );
  assert.equal(cutText(src, { mode: 'whole' }), src, 'without redact the text is untouched');
  assert.equal(cutText(src, { mode: 'lines', fragments: ['tests 58'], redact: 'paths' }), 'tests 58 pass 58 fail 0\n');
  assert.throws(() => cutText(src, { mode: 'whole', redact: 'nothing' }), /unknown redact/);
});

test('every fixture whose source holds a home or scratch path is recorded with redact "paths" in SOURCE.json', () => {
  const src = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'siblings', 'SOURCE.json'), 'utf8'));
  const redacted = src.files.filter((f) => f.cut.redact === 'paths');
  assert.ok(redacted.length >= 7, `expected at least the 7 fixtures that held paths, found ${redacted.length}`);
  for (const f of redacted) assert.ok(['whole', 'lines'].includes(f.cut.mode), `${f.repo}/${f.path}`);
});

// BUG-T1-S5-08: 'requests after offline' is stated with its scope.
test('the benchmarks page says what requests after offline counts: application requests from the page, its workers and its service worker, not the browser\'s own sw.js check and favicon fetch', () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'benchmarks', 'index.html'), 'utf8');
  const section = /<h2 id="dockit-e2e">[\s\S]*?(?=<h2 id="memory-hardening">|<h2 id="reference-machine">|<h2>Reference machine<\/h2>)/.exec(html)?.[0] ?? '';
  const flat = section.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(flat, /Requests after offline counts application requests: those made by the page, its workers and its service worker/);
  assert.match(flat, /browser itself may still check \/dockit\/sw\.js for an update and fetch the favicon/);
  assert.match(flat, /this count does not include/);
  assert.doesNotMatch(flat, /zero requests ever|no request at all/i);
});

// ---- npm run test:siblings reads the current sprint's evidence from the lane scratch folder until the architect copies it into the workspace ----

test('live mode: a current-sprint evidence file that is not in the workspace evidence folder yet is read from the lane scratch folder; no other sprint falls back', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'amlabs-site-scratch-'));
  mkdirSync(join(tmp, 'D1'), { recursive: true });
  writeFileSync(join(tmp, 'D1', 'only-in-scratch.txt'), 'from scratch\n');
  const prev = { mode: process.env.SITE_SIBLINGS, scratch: process.env.AMLABS_SCRATCH };
  process.env.SITE_SIBLINGS = 'live';
  process.env.AMLABS_SCRATCH = tmp;
  try {
    const m = await import('../scripts/sibling-fixtures.mjs?scratch-fallback');
    assert.equal(m.readSibling('evidence', `sprint-${SPRINT}/D1/only-in-scratch.txt`), 'from scratch\n');
    assert.equal(m.evidenceExists(`sprint-${SPRINT}/D1/only-in-scratch.txt`), true);
    assert.throws(() => m.readSibling('evidence', `sprint-${SPRINT - 1}/D1/only-in-scratch.txt`), /missing/);
    assert.throws(() => m.readSibling('evidence', 'sprint-4/D1/only-in-scratch.txt'), /missing/);
    assert.throws(() => m.readSibling('evidence', `sprint-${SPRINT}/D1/nowhere.txt`), /missing/);
  } finally {
    for (const [k, v] of [['SITE_SIBLINGS', prev.mode], ['AMLABS_SCRATCH', prev.scratch]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

// T3-R1-05: history that was accurate on 14 Nov, before the owner's push on 15 Nov, is dated as such, so no current-looking sentence says that
// Sprint 4 is unpushed.
const AS_OF = "As of 14 Nov 2026, before the owner's push on 15 Nov:";
test("site README: the earlier Sprint 4 paragraph reads 'pushed 15 Nov 2026 at 4bd3cb2; the pages run 43667716681 failed, so the live site still shows Sprint 2.'", () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert.ok(
    readme.includes('Sprint 4 (14 Nov 2026): pushed 15 Nov 2026 at 4bd3cb2; the pages run 43667716681 failed, so the live site still shows Sprint 2.'),
    'the Sprint 4 paragraph is not the dated one',
  );
  assert.doesNotMatch(readme, /Sprint 4 \(14 Nov 2026, committed, not pushed/);
});

test("site CHANGELOG: every earlier 'committed, not pushed' history item starts with the as-of prefix", () => {
  const items = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').split(/^- /m).slice(1);
  const history = items.filter((it) => /not pushed/.test(it) && !it.startsWith('Sprint 5 (18 Nov 2026'));
  assert.ok(history.length >= 2, `expected at least two earlier items that say not pushed, found ${history.length}`);
  for (const it of history) assert.ok(it.startsWith(AS_OF), `item does not start with the as-of prefix: ${it.slice(0, 80)}`);
});

// BUG-T1-S5-R2-05 (TD-59): correct_source_page is a CITED source naming the page; top_retrieved_page_ok is retrieval quality, in a column of its own.
test('e2e importer: needs the top_retrieved_page_ok column, and counts a refused row (no citation) in the retrieval column only, never as a correct source page', async () => {
  const { buildE2e } = await e2eImporter();
  const text = readFileSync(E2E_FIXTURE, 'utf8');
  const q = readFileSync(E2E_Q_FIXTURE, 'utf8');
  assert.throws(() => buildE2e(text, q.replace('top_retrieved_page_ok', 'x')), /top_retrieved_page_ok/);
  const head = 'date,machine,commit,run,restart,qid,answer_ok,correct_source_page,top_retrieved_page_ok,first_token_ms,total_ms,laptop_8gb';
  const row = (qid, ok, cited, top) => `2026-11-18T00:00:00.000Z,m,abc1234,1,false,${qid},${ok},${cited},${top},1,2,not measured on 8 GB`;
  const csv = [head, row('q1', true, true, true), row('q2', false, false, true), row('q3', true, false, true), row('q7', true, '', '')].join('\n') + '\n';
  const d = buildE2e(text, csv);
  const by = (id) => d.questions.perQuestion.find((x) => x.qid === id);
  assert.deepEqual([by('q2').answerOk, by('q2').pageOk, by('q2').topRetrievedOk], [0, 0, 1], 'a refused row is not a correct source page');
  assert.deepEqual([by('q3').answerOk, by('q3').pageOk, by('q3').topRetrievedOk], [1, 0, 1], 'a right answer that cites the wrong page is not a correct source page');
  assert.deepEqual(d.questions.firstRun, { correct: 1, of: 3, run: 1 }, 'the joint figure keeps its definition: answer_ok and correct_source_page');
  assert.deepEqual(d.questions.citedPage, { ok: 1, of: 3 });
  assert.deepEqual(d.questions.topRetrieved, { ok: 3, of: 3 });
  // a row that is not answerable has no page in either column
  assert.equal(by('q7').answerable, false);
  // the two columns agree on what 'answerable' is: a blank in one and a value in the other is a broken file
  assert.throws(() => buildE2e(text, csv.replace(',true,,,1,2,', ',true,,true,1,2,')), /top_retrieved_page_ok/);
});

test('the real dockit CSV (committed copy) has the top_retrieved_page_ok column, and a row with no cited page and no answer is never a correct source page', () => {
  const lines = REAL_E2E_Q().trim().split('\n');
  const head = lines[0].split(',');
  for (const c of ['correct_source_page', 'top_retrieved_page_ok']) assert.ok(head.includes(c), `no ${c} column`);
  assert.equal(head.indexOf('top_retrieved_page_ok'), head.indexOf('correct_source_page') + 1);
  for (const l of lines.slice(1)) {
    const f = l.split(',');
    const cited = f[head.indexOf('correct_source_page')];
    const top = f[head.indexOf('top_retrieved_page_ok')];
    assert.ok(['true', 'false', ''].includes(cited) && ['true', 'false', ''].includes(top), l);
    assert.equal(cited === '', top === '', 'blank in one column only');
  }
});

test('the built benchmarks page labels the two columns: Cited source page correct, Top-ranked retrieved passage on the right page', () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'benchmarks', 'index.html'), 'utf8');
  const section = /<h2 id="dockit-e2e">[\s\S]*?(?=<h2 id="memory-hardening">|<h2 id="reference-machine">|<h2>Reference machine<\/h2>)/.exec(html)?.[0] ?? '';
  assert.match(section, /<th>Cited source page correct<\/th>/);
  assert.match(section, /<th>Top-ranked retrieved passage on the right page<\/th>/);
  assert.doesNotMatch(section, /<th>Source page correct<\/th>/);
  const e2e = JSON.parse(readFileSync(join(root, 'data', 'e2e.json'), 'utf8'));
  assert.ok(section.includes(`<strong>${e2e.questions.firstRun.correct} of ${e2e.questions.firstRun.of}</strong> correct with the correct source page`), 'the headline keeps its wording');
  const flat = section.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(flat, /a refused answer cites nothing/i);
  assert.ok(flat.includes(`${e2e.questions.citedPage.ok} of ${e2e.questions.citedPage.of}`), 'the cited-page total is stated');
  assert.ok(flat.includes(`${e2e.questions.topRetrieved.ok} of ${e2e.questions.topRetrieved.of}`), 'the retrieval total is stated');
  // the old wording that credited an uncited top-ranked source is gone
  assert.doesNotMatch(flat, /or, with no citation, the top-ranked source/);
});
