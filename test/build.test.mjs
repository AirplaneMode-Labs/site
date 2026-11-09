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
