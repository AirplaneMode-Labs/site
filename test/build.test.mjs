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

test('benchmarks page carries the 8 GB laptop columns and only "not measured" cells', () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'benchmarks', 'index.html'), 'utf8');
  assert.match(html, /8 GB Windows/);
  assert.match(html, /not measured/);
  assert.doesNotMatch(html, /\d+(\.\d+)?\s*(MB\/s|tok\/s|ms)\b/, 'a figure appeared without a measurement');
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

test('demos.json lists exactly the six demos with consistent URLs, statuses and one written-on date', () => {
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  assert.equal(demos.length, 6);
  assert.deepEqual(new Set(demos.map((d) => d.repo)), new Set(DEMO_REPOS));
  for (const d of demos) {
    assert.match(d.url, /^https:\/\/airplanemode-labs\.github\.io\/[a-z]+\/$/, `${d.repo}: url shape`);
    assert.equal(d.url, `https://airplanemode-labs.github.io/${d.repo}/`, `${d.repo}: url does not match repo`);
    assert.ok(typeof d.status === 'string' && d.status.length > 0, `${d.repo}: empty status`);
    assert.equal(d.writtenOn, '2026-11-09', `${d.repo}: writtenOn`);
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
  assert.match(html, /written on 9 Nov 2026 from local builds served under \/&lt;repo&gt;\//);
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
  assert.match(html, /Statuses written on 9 Nov 2026 from local builds, not measured at the live URLs\./);
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

test('the Sprint 2 write-up is a skeleton: honest-claim wording present, every slot empty, no stray figures', () => {
  const html = readFileSync(join(root, 'writeups', '2026-11-sprint-2.html'), 'utf8');
  const flat = html.replace(/\s+/g, ' ');
  assert.ok(
    flat.includes(
      'Same prompt answered on WebGPU and on WebAssembly with the test model SmolLM2-135M-Instruct (q4), in Chrome on an Apple-silicon Mac only. This is not the Hindi production model; Windows and the 8 GB no-GPU laptop are not measured.',
    ),
    'done-when wording missing',
  );
  assert.ok(
    flat.includes(
      'Planned production model: Qwen3-1.7B (Apache-2.0), WebGPU q4f16 1.43 GB, WASM q8 1.74 GB. Provisional until the Sprint 5 measurement on an 8 GB laptop; contingency Qwen3-0.6B.',
    ),
    'model card wording missing',
  );
  assert.doesNotMatch(flat, /not yet loaded in a browser/);
  assert.ok(
    flat.includes(
      'Loaded once in a browser: a local, unscored WebGPU smoke run of five synthetic Hindi prompts on an Apple-silicon Mac, which needed ONNX Runtime graph optimisation turned off (evidence/sprint-2/D1/hindi-smoke.json).',
    ),
    'smoke-run sentence missing',
  );
  assert.match(flat, /to be filled by the PO at wrap-up from/);
  assert.doesNotMatch(html, /<script|\sstyle="|https?:\/\//i);
  // Remove everything that is allowed to contain digits, then none may remain.
  const stripped = flat
    .replace(/<!--.*?-->/g, ' ')
    .replace(/Loaded once in a browser: a local, unscored WebGPU smoke run of five synthetic Hindi prompts on an Apple-silicon Mac, which needed ONNX Runtime graph optimisation turned off \(evidence\/sprint-2\/D1\/hindi-smoke\.json\)\./g, ' ')
    .replace(/<code>.*?<\/code>/g, ' ') // named commands
    .replace(/Planned production model: Qwen3-1\.7B.*?contingency Qwen3-0\.6B\./g, ' ')
    .replace(/SmolLM2-135M-Instruct/g, ' ')
    .replace(/Qwen3-(1\.7B|0\.6B)/g, ' ')
    .replace(/\b\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December)( \d{4})?\b/g, ' ')
    .replace(/\b\d{1,2} (to|and) \d{1,2} (November|December)( \d{4})?\b/g, ' ')
    .replace(/\bSprint \d\b/g, ' ')
    .replace(/\b8 GB\b/g, ' ')
    .replace(/\b[TDS]\d\b/g, ' ') // lane and role ids named as report sources
    .replace(/CC BY 4\.0/g, ' ') // licence name
    .replace(/\bq4f16\b|\bq4\b|\bq8\b/g, ' ')
    .replace(/<[^>]+>/g, ' ');
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

test('benchmarks.json has the two Sprint 2 slots, both "not measured", with their reproduce commands', () => {
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
  for (const r of [gs, rt]) {
    assert.equal(r.dev, 'not measured', `${r.repo}: dev cell`);
    assert.equal(r.laptop, 'not measured', `${r.repo}: laptop cell`);
  }
  // No row may carry a figure unless it is the literal "not measured".
  for (const r of data.rows) {
    assert.equal(r.dev, 'not measured', `${r.benchmark}: dev`);
    assert.equal(r.laptop, 'not measured', `${r.benchmark}: laptop`);
  }
});

test('every demos.json status line carries a Sprint 2 date and the keys and URLs are unchanged', () => {
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  assert.equal(demos.length, 6);
  for (const d of demos) {
    assert.deepEqual(Object.keys(d).sort(), ['repo', 'status', 'url', 'writtenOn'], `${d.repo}: keys`);
    assert.match(d.status, /^Sprint 2 \(\d{1,2} (Nov|Dec) 2026\): /, `${d.repo}: Sprint 2 date`);
  }
  assert.deepEqual(new Set(demos.map((d) => d.url)), new Set(DEMO_URLS));
});

test('the demos page not-yet box lists the four site limits and the page text derives its date from the data', () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'demos', 'index.html'), 'utf8');
  assert.match(html, /<li>No search\.<\/li>/);
  assert.match(html, /<li>No RSS feed\.<\/li>/);
  assert.match(html, /Benchmarks are unmeasured/);
  assert.match(html, /hand-written and dated/);
  assert.doesNotMatch(html, /\{\{/, 'unreplaced placeholder');
});

test('no built page contains a script tag (Sprint 2 pages included)', () => {
  const { out } = buildToTemp();
  for (const file of walk(out).filter((f) => f.endsWith('.html'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /<script/i, `${file} has <script`);
  }
});

test('no demos.json status line still says "not in this status yet" and runtime/glyphsift lines match T1 observations', () => {
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  for (const d of demos) {
    assert.doesNotMatch(d.status, /not in this status yet/, `${d.repo}: stale status`);
    assert.match(d.status, /^Sprint 2 \(9 Nov 2026\): /, `${d.repo}: prefix`);
  }
  const by = Object.fromEntries(demos.map((d) => [d.repo, d.status]));
  assert.match(by.runtime, /WebGPU/);
  assert.match(by.runtime, /Force WASM/);
  assert.match(by.runtime, /freezes while WebAssembly generates/);
  assert.match(by.glyphsift, /sixteen/);
  assert.match(by.dockit, /plan and a prediction only/);
  assert.match(by.dockit, /no inference until Sprint 5/);
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
