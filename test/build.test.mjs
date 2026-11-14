import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, checkDemos, ALLOWED_RESOURCE_HOSTS } from '../scripts/build.mjs';

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

test('papers page lists exactly 30 papers, each with a status and an area', () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'papers', 'index.html'), 'utf8');
  const rows = [...html.matchAll(/<tr class="paper" data-status="([^"]*)" data-area="([^"]*)"/g)];
  assert.equal(rows.length, 30);
  for (const [, status, area] of rows) {
    assert.ok(status.length > 0, 'empty status');
    assert.ok(area.length > 0, 'empty area');
  }
});

test('papers.json entries are well-formed and follow the citation rule', () => {
  const papers = JSON.parse(readFileSync(join(root, 'data', 'papers.json'), 'utf8'));
  assert.equal(papers.length, 30);
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
  for (const row of html.match(/<tr><td>.*?<\/tr>/gs) ?? []) {
    if (/\d+(\.\d+)?\s*(MB\/s|tok\/s|ms)\b/.test(row)) {
      assert.match(row, /Evidence: evidence\/sprint-\d\//, `a figure appeared without its evidence: ${row}`);
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

/**
 * D1's LANDED.json, or undefined when it is not reachable. Lookup order: env LANDED_JSON, the committed
 * workspace copy (<workspace>/evidence/sprint-3/D1/LANDED.json), then the local scratch copy. A hosted CI run
 * that has only this repository finds none, and the checks that need it are skipped, never guessed.
 */
function readLanded() {
  const candidates = [
    process.env.LANDED_JSON ?? '',
    join(root, '..', 'evidence', 'sprint-3', 'D1', 'LANDED.json'),
    '/private/tmp/airplanemode-team/sprint-3/D1/LANDED.json',
  ].filter((p) => p !== '');
  const path = candidates.find((p) => existsSync(p));
  return path === undefined ? undefined : JSON.parse(readFileSync(path, 'utf8'));
}
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
    assert.equal(d.writtenOn, '2026-11-14', `${d.repo}: writtenOn`);
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
  assert.match(html, /written on 14 Nov 2026 from local builds served under \/&lt;repo&gt;\//);
  assert.match(html, /nothing on this page was measured against the live URLs/);
  assert.equal((html.match(/<h2>What this demo does not do yet<\/h2>/g) ?? []).length, 1, 'exactly one not-yet heading');
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  for (const d of demos) assert.ok(html.includes(d.status.replace(/&/g, '&amp;')), `${d.repo}: status text missing`);
});

test('the home page has a Demos section with the six URLs before Repositories and the honesty line', () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  for (const u of DEMO_URLS) assert.ok(html.includes(`href="${u}"`), `${u} missing from home`);
  const demosAt = html.indexOf('<h2>Demos</h2>');
  const reposAt = html.indexOf('<h2>Repositories</h2>');
  assert.ok(demosAt > 0 && reposAt > demosAt, 'Demos section must precede Repositories');
  assert.match(html, /Statuses written on 14 Nov 2026 from local builds, not measured at the live URLs\./);
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
    'cargo run -p glyphsift-cli --release -- bench --corpus bench/corpus/clean.txt --seeds 1,2,3 --csv docs/score-vs-noise.csv --svg docs/score-vs-noise.svg',
  );
  const rt = data.rows.find((r) => /WebGPU versus WASM/i.test(r.benchmark));
  assert.ok(rt, 'runtime WebGPU versus WASM row missing');
  assert.equal(rt.repo, 'runtime');
  assert.equal(rt.command, 'RUNTIME_MODEL=1 RUNTIME_REQUIRE_WEBGPU=1 npm run test:model');
  assert.match(rt.benchmark, /SmolLM2-135M/);
  for (const r of data.rows) {
    // The 8 GB Windows no-GPU laptop has not been measured: no figure may appear in that column.
    assert.equal(r.laptop, 'not measured', `${r.benchmark}: laptop`);
    if (r.dev !== 'not measured') {
      assert.match(r.evidence ?? '', /^evidence\/sprint-\d\//, `${r.benchmark}: a figure without evidence`);
      assert.ok(r.command, `${r.benchmark}: a figure without a command`);
    }
  }
});

test('every demos.json status line carries a Sprint 3 date and the keys and URLs are unchanged', () => {
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  assert.equal(demos.length, 6);
  for (const d of demos) {
    assert.deepEqual(Object.keys(d).sort(), ['repo', 'status', 'url', 'writtenOn'], `${d.repo}: keys`);
    assert.match(d.status, /^Sprint 3 \(14 Nov 2026\): /, `${d.repo}: Sprint 3 date`);
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
  assert.match(html, /8 GB Windows no-GPU column reads "not measured" in every\s+row/);
  assert.match(html, /hand-written and dated/);
  assert.doesNotMatch(html, /\{\{/, 'unreplaced placeholder');
});

test('no built page contains a script tag (Sprint 2 pages included)', () => {
  const { out } = buildToTemp();
  for (const file of walk(out).filter((f) => f.endsWith('.html'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /<script/i, `${file} has <script`);
  }
});

test('demos.json lines claim nothing the Sprint 3 gates (LANDED.json) do not mark green', (t) => {
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  const landed = readLanded();
  if (landed === undefined) t.diagnostic('LANDED.json not reachable: the worker and Trusted Types claims are not cross-checked');
  const green = (k) => isGreen(landed, k);
  for (const d of demos) {
    assert.doesNotMatch(d.status, /not in this status yet/, `${d.repo}: stale status`);
    assert.match(d.status, /^Sprint 3 \(14 Nov 2026\): /, `${d.repo}: prefix`);
    assert.doesNotMatch(d.status, /licensing|licence policy|policy page/i, `${d.repo}: must not advertise the licensing draft`);
    // A claim sentence is anything before 'Not yet'; the Not yet tail may name what is missing.
    const claimed = d.status.split(/Not yet/)[0];
    // WebLLM did not land in Sprint 3: it is never claimed. Without a LANDED.json this is still the rule.
    if (!green('webllm')) assert.doesNotMatch(claimed, /WebLLM/, `${d.repo}: WebLLM claim without green`);
    if (landed !== undefined && !green('worker')) assert.doesNotMatch(claimed, /engine runs in a worker|in a worker/i, `${d.repo}: worker claim without green`);
    if (landed !== undefined && !green('trustedTypes')) assert.doesNotMatch(claimed, /Trusted Types/, `${d.repo}: Trusted Types claim without green`);
  }
  const by = Object.fromEntries(demos.map((d) => [d.repo, d.status]));
  assert.match(by.dockit, /plan and a prediction only/);
  assert.match(by.dockit, /no inference until Sprint 5/);
  assert.match(by.runtime, /WebGPU/);
  assert.match(by.glyphsift, /sixteen/);
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

test('pagetriage and localdata lines say the page shows the build id, not a status line', () => {
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  for (const repo of ['pagetriage', 'localdata']) {
    const line = demos.find((d) => d.repo === repo).status;
    assert.doesNotMatch(line, /status line/, `${repo}: stale 'status line'`);
    assert.match(line, /the page shows the build id/, `${repo}: build id wording`);
  }
});

test('every page footer shows the build id: first 12 hex of a 40-hex GITHUB_SHA, else "local"', () => {
  const SHA = 'abcdef0123456789abcdef0123456789abcdef01';
  const cases = [
    [undefined, 'local'],
    ['', 'local'],
    ['abc123', 'local'],
    [SHA.toUpperCase(), 'local'],
    [SHA + '0', 'local'],
    ['<script>alert(1)</script>' + 'a'.repeat(20), 'local'],
    [SHA, 'abcdef012345'],
  ];
  const prev = process.env.GITHUB_SHA;
  try {
    for (const [val, want] of cases) {
      if (val === undefined) delete process.env.GITHUB_SHA;
      else process.env.GITHUB_SHA = val;
      const { out } = buildToTemp();
      for (const file of walk(out).filter((f) => f.endsWith('.html'))) {
        const html = readFileSync(file, 'utf8');
        assert.match(html, new RegExp(`Built \\d{4}-\\d{2}-\\d{2} · build ${want}\\b`), `${file} (${val}): build id`);
        assert.doesNotMatch(html, /<script/i);
      }
    }
  } finally {
    if (prev === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = prev;
  }
});

// ---- Sprint 3: draft pages (licensing policy, write-up skeleton), benchmark slots ----

const SIBLINGS = join(root, '..');
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

test('licences.json lists the seven repos and equals each sibling LICENSE file', () => {
  const data = JSON.parse(readFileSync(join(root, 'data', 'licences.json'), 'utf8'));
  assert.deepEqual(data.repos.map((r) => r.repo), LICENCE_REPOS);
  const byRepo = Object.fromEntries(data.repos.map((r) => [r.repo, r]));
  assert.equal(byRepo.pagetriage.licence, 'MIT OR Apache-2.0');
  for (const r of ['glyphsift', 'localdata', 'runtime', 'dockit', 'site']) assert.equal(byRepo[r].licence, 'Apache-2.0');
  assert.match(byRepo['control-plane'].licence, /^Functional Source License, Version 1\.1, Apache 2\.0 Future License \(FSL-1\.1-Apache-2\.0; SPDX FSL-1\.1-ALv2\)$/);
  assert.equal(byRepo['control-plane'].visibility, 'private');
  // Read against the sibling files (skipped per repo only when the sibling clone is absent).
  for (const repo of LICENCE_REPOS) {
    const dir = join(SIBLINGS, repo);
    if (!existsSync(dir)) continue;
    if (repo === 'pagetriage') {
      assert.match(readFileSync(join(dir, 'LICENSE-APACHE'), 'utf8'), /Apache License\s+Version 2\.0/);
      assert.match(readFileSync(join(dir, 'LICENSE-MIT'), 'utf8'), /^MIT License/);
    } else if (repo === 'control-plane') {
      const t = readFileSync(join(dir, 'LICENSE'), 'utf8');
      assert.match(t, /^Functional Source License, Version 1\.1, Apache 2\.0 Future License/);
      assert.match(t, /FSL-1\.1-Apache-2\.0/);
    } else {
      assert.match(readFileSync(join(dir, 'LICENSE'), 'utf8'), /Apache License\s+Version 2\.0/, `${repo}: LICENSE is not Apache-2.0`);
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

test('the Sprint 3 write-up is an unlisted noindex skeleton with no figures', () => {
  const html = readFileSync(join(root, 'writeups', '2026-11-sprint-3.html'), 'utf8');
  assert.match(html, /<meta name="draft" content="true"/);
  for (const h of ['What we tried', 'What held up', 'What did not', 'Numbers', 'Limitations']) {
    assert.match(html, new RegExp(`<h2>${h}</h2>`), `section ${h} missing`);
  }
  assert.match(html, /to be filled from evidence\/sprint-3 at wrap-up/);
  assert.doesNotMatch(html, /<script|\sstyle="|https?:\/\//i);
  // No digit anywhere except the sprint number, years and dates, and the evidence path.
  const stripped = html
    .replace(/<!--.*?-->/gs, ' ')
    .replace(/<meta[^>]*>/g, ' ')
    .replace(/evidence\/sprint-3/g, ' ')
    .replace(/\bSprint 3\b/g, ' ')
    .replace(/\b\d{1,2} (to \d{1,2} )?(November|December) 2026\b/g, ' ')
    .replace(/\b8 GB\b/g, ' ')
    .replace(/CC BY 4\.0/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  const stray = stripped.match(/[^\s]*\d[^\s]*/g) ?? [];
  assert.deepEqual(stray, [], `figures in the skeleton: ${stray.join(' | ')}`);
  const { out } = buildToTemp();
  const built = readFileSync(join(out, 'writeups', '2026-11-sprint-3', 'index.html'), 'utf8');
  assert.match(built, /<meta name="robots" content="noindex" \/>/);
  const idx = readFileSync(join(out, 'writeups', 'index.html'), 'utf8');
  assert.doesNotMatch(idx, /2026-11-sprint-3|Sprint 3/);
});

test('Sprint 3 benchmark slots read not measured in both columns, with no figure and no evidence', () => {
  const data = JSON.parse(readFileSync(join(root, 'data', 'benchmarks.json'), 'utf8'));
  const timing = data.rows.find((r) => /model-load timing per phase/i.test(r.benchmark));
  const mem = data.rows.find((r) => /memory at model load/i.test(r.benchmark));
  assert.ok(timing && mem, 'timing and memory rows missing');
  assert.match(timing.benchmark, /acquire, verify, hand-off, session, first token/);
  assert.match(timing.benchmark, /SmolLM2-135M WASM and WebGPU/);
  assert.match(mem.benchmark, /page JS heap where Chrome exposes it; worker where exposed/);
  for (const r of [timing, mem]) {
    assert.equal(r.repo, 'runtime');
    assert.equal(r.dev, 'not measured');
    assert.equal(r.laptop, 'not measured');
    assert.equal(r.evidence, undefined, 'the PO adds evidence when a figure exists');
  }
  // Absent LANDED.json reads as 'not green': WebLLM did not land in Sprint 3, so no WebLLM row may exist.
  const webllmGreen = isGreen(readLanded(), 'webllm');
  assert.equal(data.rows.some((r) => /WebLLM/.test(r.benchmark)), webllmGreen, 'WebLLM rows only when LANDED.json webllm is green');
  assert.equal(/SmolLM2-360M WebLLM/.test(timing.benchmark), webllmGreen);
});

test('glyphsift score-versus-noise row carries the mixed means recomputed from the regenerated CSV and its Sprint 3 evidence', () => {
  const data = JSON.parse(readFileSync(join(root, 'data', 'benchmarks.json'), 'utf8'));
  const gs = data.rows.find((r) => /score versus noise/i.test(r.benchmark));
  const FIGURES = ['1,000,000', '998,476', '996,985', '991,696', '983,977', '967,538', '933,440'];
  assert.equal(
    gs.dev,
    `Mixed-family mean, ppm, at p = 0, 0.01, 0.02, 0.05, 0.1, 0.2, 0.4: ${FIGURES.join('; ')}. Falls at every step.`,
  );
  assert.equal(gs.evidence, 'evidence/sprint-3/D3/bench-s3.log and docs/score-vs-noise.csv');
  assert.equal(gs.laptop, 'not measured');
  for (const old of ['998,454', '996,931', '991,588', '983,739', '967,065', '932,405']) {
    assert.ok(!gs.dev.includes(old), `stale Sprint 2 figure ${old} still in the row`);
  }
});

test('the glyphsift row equals a fresh computation over the sibling docs/score-vs-noise.csv (skipped when the sibling is absent)', (t) => {
  const csv = join(SIBLINGS, 'glyphsift', 'docs', 'score-vs-noise.csv');
  if (!existsSync(csv)) return t.skip('glyphsift sibling absent');
  const [head, ...lines] = readFileSync(csv, 'utf8').trim().split('\n');
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

test('the licensing promise sentence names pagetriage MIT OR Apache-2.0 and marks wording beyond the plan', () => {
  const html = readFileSync(join(root, 'src', 'pages', 'licensing.html'), 'utf8');
  const flat = html.replace(/\s+/g, ' ');
  const promise = /<h2>The promise<\/h2>(.*?)<h2>/s.exec(flat)?.[1] ?? '';
  const items = [...promise.matchAll(/<li>(.*?)<\/li>/gs)].map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  const never = items.find((i) => /never relicense/i.test(i));
  assert.ok(never, 'the never-relicense promise is missing');
  assert.ok(never.includes('MIT OR Apache-2.0'), `the promise does not name pagetriage's dual licence: ${never}`);
  assert.match(never, /pagetriage/);
  assert.match(never, /\[owner to confirm/, 'the pagetriage wording goes beyond the plan text and must be marked');
  assert.doesNotMatch(flat, /Every browser library and the core runtime are Apache-2\.0\./, 'the unqualified Apache-2.0 sentence contradicts the pagetriage row');
  assert.match(flat, /What the core covers/i);
  assert.match(flat, /Apache-2\.0 for every browser library and the core runtime/);
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
  assert.match(flat, /Sprint 3 is the runtime alpha, including the WebLLM backend/, 'the original sentence stays; the correction is appended, not a silent rewrite');
});

test('the home page repository table shows Sprint 3 statuses, not the Sprint 1 ones', () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  for (const stale of ['validator lands in Sprint 2', 'drivers and behavioural suite in Sprint 1', 'Sprint 1: specs, capability profile and asset manager', 'release preparation in progress', 'Skeleton; tests written']) {
    assert.ok(!html.includes(stale), `stale home status: ${stale}`);
  }
  const row = (repo) => new RegExp(`<tr><td>(?:<a [^>]*>)?${repo}(?:</a>)?</td>.*?</tr>`).exec(html)?.[0] ?? '';
  assert.match(row('glyphsift'), /Release candidate 0\.1\.0 \(not tagged, not published\)/);
  assert.match(row('runtime'), /Alpha 0\.2\.0-alpha\.0 \(not tagged, not published\)/);
  assert.match(row('runtime'), /WebLLM is Sprint 4/);
  assert.match(row('localdata'), /0\.1\.0-dev/);
  assert.match(row('localdata'), /query\(\) lands in Sprint 4/);
  assert.match(row('pagetriage'), /not published, no tag yet/);
  assert.match(row('dockit'), /first working demo in Sprint 5/);
  // The licence column still equals data/licences.json for the six public repos plus control-plane.
  assert.match(row('pagetriage'), /MIT OR Apache-2\.0/);
});
