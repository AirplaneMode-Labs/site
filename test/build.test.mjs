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
  for (const row of html.match(/<tr><td>.*?<\/tr>/gs) ?? []) {
    if (/\d+(\.\d+)?\s*(MB\/s|tok\/s|ms)\b/.test(row)) {
      assert.match(row, /Evidence: (evidence\/sprint-\d\/|localdata\/docs\/benchmarks\/vector-index\.csv)/, `a figure appeared without its evidence: ${row}`);
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
 * D1's LANDED.json, or undefined when it is not reachable. Lookup: env LANDED_JSON (a single file; a missing
 * file is an error), else every <workspace>/evidence/sprint-<n>/D1/LANDED.json merged in ascending sprint order,
 * so a later sprint's entry for a key replaces an earlier one and a key the later file does not mention keeps
 * its last value (Sprint 4's file does not repeat the worker, which landed in Sprint 3). No scratch path is read.
 * A hosted CI run that has only this repository finds none, and the checks that need it are skipped, never guessed.
 */
function readLanded() {
  const fromEnv = process.env.LANDED_JSON ?? '';
  if (fromEnv !== '') {
    if (!existsSync(fromEnv)) throw new Error(`LANDED_JSON names a file that does not exist: ${fromEnv}`);
    return JSON.parse(readFileSync(fromEnv, 'utf8'));
  }
  const evidence = join(root, '..', 'evidence');
  if (!existsSync(evidence)) return undefined;
  const sprints = readdirSync(evidence)
    .map((n) => /^sprint-(\d+)$/.exec(n))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((x, y) => x - y);
  let merged;
  for (const n of sprints) {
    const file = join(evidence, `sprint-${n}`, 'D1', 'LANDED.json');
    if (existsSync(file)) merged = { ...(merged ?? {}), ...JSON.parse(readFileSync(file, 'utf8')) };
  }
  return merged;
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
      assert.match(r.evidence ?? '', /^(evidence\/sprint-\d\/|localdata\/docs\/benchmarks\/vector-index\.csv$)/, `${r.benchmark}: a figure without evidence`);
      assert.ok(r.command, `${r.benchmark}: a figure without a command`);
    }
  }
});

test('every demos.json status line carries a Sprint 3 or Sprint 4 date (dockit and site: Sprint 4) and the keys and URLs are unchanged', () => {
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  assert.equal(demos.length, 6);
  for (const d of demos) {
    assert.deepEqual(Object.keys(d).sort(), ['repo', 'status', 'url', 'writtenOn'], `${d.repo}: keys`);
    assert.match(d.status, /^Sprint [34] \(14 Nov 2026\)[:.] /, `${d.repo}: Sprint 3 or 4 date`);
  }
  // D5 owns the dockit and site lines; the product owner rewrites the other four at close-out.
  for (const repo of ['dockit', 'site']) {
    const d = demos.find((x) => x.repo === repo);
    assert.match(d.status, /^Sprint 4 \(14 Nov 2026\): /, `${repo}: must be a Sprint 4 line`);
    assert.equal(d.writtenOn, '2026-11-14', `${repo}: writtenOn`);
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
    assert.match(d.status, /^Sprint [34] \(14 Nov 2026\)[:.] /, `${d.repo}: prefix`);
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
    assert.match(notYet, /WebLLM (\(cut from Sprint 4\)|not yet \(cut from Sprint 4\))/);
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
    assert.match(line, /^Sprint 4 \(14 Nov 2026\)[:.] /, `${repo}: Sprint 4 line`);
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

// ---- Sprint 4 (D5-04, droppable first): the Sprint 3 write-up is finished from evidence/sprint-3 only; the Sprint 4 write-up is a skeleton ----

const EVID3 = join(SIBLINGS, 'evidence', 'sprint-3');
// A missing file reads as empty, so the tests below fail with their own message instead of killing the run.
const readOrEmpty = (rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : '');
const SPRINT3_WRITEUP = readOrEmpty('writeups/2026-11-sprint-3.html');
const SPRINT4_WRITEUP = readOrEmpty('writeups/2026-11-sprint-4.html');
const ALLOWED_NUMBER_TOKENS = [
  /\bSprints? [1-6]\b/g,
  /\b\d{1,2} (to \d{1,2} )?(November|December|Nov) 2026\b/g,
  /\b\d{1,2} January 2027\b/g,
  /\b8 GB\b/g,
  /\bM5 Pro\b/g,
  /\bmanifest spec v0\.1\b/g,
  /CC BY 4\.0/g,
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
  if (existsSync(EVID3)) for (const rel of cited) assert.ok(existsSync(join(EVID3, rel)), `evidence/sprint-3/${rel} does not exist`);
});

test('Sprint 3 write-up: each figure equals the saved evidence it cites', () => {
  if (!existsSync(EVID3)) return; // a clone without the workspace evidence folder skips, never guesses
  const flat = SPRINT3_WRITEUP.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const read = (rel) => readFileSync(join(EVID3, rel), 'utf8');
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

test('Sprint 4 write-up: an unlisted noindex skeleton with the five headings, each marked for the product owner, no figures and no scratch path', () => {
  assert.match(SPRINT4_WRITEUP, /<meta name="draft" content="true"/);
  const heads = [...SPRINT4_WRITEUP.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(heads, ['What we tried', 'What held up', 'What did not', 'Numbers (Apple M5 Pro; not measured on 8 GB)', 'Limitations']);
  const sections = SPRINT4_WRITEUP.split(/<h2>/).slice(1);
  assert.equal(sections.length, 5);
  for (const sec of sections) assert.ok(sec.includes('[product owner to finish at close-out]'), `section not marked: ${sec.slice(0, 40)}`);
  assert.doesNotMatch(SPRINT4_WRITEUP, /\/private\/tmp|<script|\sstyle="|https?:\/\//i);
  const stray = figureElements(SPRINT4_WRITEUP).filter(hasStrayNumber);
  assert.deepEqual(stray, [], `figures in the skeleton: ${stray.join(' || ')}`);
  const flat = SPRINT4_WRITEUP.replace(/\s+/g, ' ');
  assert.match(flat, /Sprint 4 \(planned 21 December 2026 to 3 January 2027/);
  assert.match(flat, /manifest spec v0\.1 published in runtime\/spec \(committed; public after the owner's push\)/);
  const { out } = buildToTemp();
  const built = readFileSync(join(out, 'writeups', '2026-11-sprint-4', 'index.html'), 'utf8');
  assert.match(built, /<meta name="robots" content="noindex" \/>/);
  const idx = readFileSync(join(out, 'writeups', 'index.html'), 'utf8');
  assert.doesNotMatch(idx, /2026-11-sprint-4|Sprint 4/);
});

test('both Sprint write-up drafts are linked from no page and carry no scratch path', () => {
  const { out } = buildToTemp();
  for (const file of walk(out).filter((f) => f.endsWith('.html'))) {
    const rel = file.slice(out.length + 1).replaceAll('\\', '/');
    const html = readFileSync(file, 'utf8');
    assert.doesNotMatch(html, /\/private\/tmp/, `${rel} names a scratch path`);
    if (/^writeups\/2026-11-sprint-[34]\//.test(rel)) continue;
    assert.doesNotMatch(html, /href="[^"]*2026-11-sprint-[34]/, `${rel} links to a sprint write-up draft`);
  }
});

// Sprint 4 (D5-05, droppable third): the two Sprint 3 slots are filled from the saved DevTools-panel figures.
const D1_DEVTOOLS = join(SIBLINGS, 'evidence', 'sprint-3', 'D1', 'devtools', 'devtools-figures.json');
const T1_DEVTOOLS = join(SIBLINGS, 'evidence', 'sprint-3', 'T1', 'r3', 'devtools', 'devtools-figures-t1.json');
const fmtMs = (n) => `${Number(n.toFixed(1)).toLocaleString('en-US')} ms`;

test('Sprint 3 slots are filled from the saved DevTools-panel figures, command RUNTIME_MODEL=1 npm run test:devtools (headed), labelled Apple silicon', () => {
  const data = JSON.parse(readFileSync(join(root, 'data', 'benchmarks.json'), 'utf8'));
  const timing = data.rows.find((r) => /model-load timing per phase/i.test(r.benchmark));
  const mem = data.rows.find((r) => /memory at model load/i.test(r.benchmark));
  assert.ok(timing && mem, 'timing and memory rows missing');
  assert.match(timing.benchmark, /acquire, verify, hand-off, session, first token/);
  assert.match(timing.benchmark, /SmolLM2-135M, WebAssembly engine in a worker/);
  assert.match(mem.benchmark, /page JS heap where Chrome exposes it; worker where exposed/);
  for (const r of [timing, mem]) {
    assert.equal(r.repo, 'runtime');
    assert.equal(r.command, 'RUNTIME_MODEL=1 npm run test:devtools (headed)');
    assert.equal(r.laptop, 'not measured', 'the 8 GB cell stays not measured');
    assert.match(r.dev, /^Apple silicon, Chrome 157\.0\.8103\.79/);
    assert.equal(r.evidence, 'evidence/sprint-3/D1/devtools/devtools-figures.json and evidence/sprint-3/T1/r3/devtools/devtools-figures-t1.json');
    assert.match(r.notes, /placeholder until the 8 GB laptop is measured/);
    assert.match(r.notes, /not measured on 8 GB/);
    assert.doesNotMatch(r.dev + r.notes, /not yet run/);
  }
  assert.match(timing.dev, /WebGPU not measured here/);
  assert.match(mem.dev, /worker heap and WebAssembly memory were not exposed/);
  // Every figure equals the saved panel output (skipped only when the evidence folder is absent, never guessed).
  if (existsSync(D1_DEVTOOLS) && existsSync(T1_DEVTOOLS)) {
    const d1 = JSON.parse(readFileSync(D1_DEVTOOLS, 'utf8'));
    const t1 = JSON.parse(readFileSync(T1_DEVTOOLS, 'utf8'));
    assert.ok(timing.dev.includes(d1.chrome.replace('Chrome/', 'Chrome ')) || timing.dev.includes(d1.chrome.replace('Chrome/', '')), 'Chrome version');
    for (const [label, run] of [['D1 run', d1], ['T1 run', t1]]) {
      assert.ok(timing.dev.includes(label), `${label} missing from the timing cell`);
      assert.ok(mem.dev.includes(label), `${label} missing from the memory cell`);
      for (const phase of ['acquire', 'verify', 'handoff', 'session', 'first_token']) {
        const want = fmtMs(run.panelPhaseDurationsMs[phase]);
        assert.ok(timing.dev.includes(want), `${label}: ${phase} ${want} not in the timing cell`);
      }
      for (const m of run.panelMemory.filter((x) => (x.scope ?? 'page') === 'page' && x.api === 'performance.memory')) {
        assert.ok(mem.dev.includes(m.used), `${label}: ${m.at} ${m.used} not in the memory cell`);
      }
    }
  }
  // WebLLM did not land and was cut from Sprint 4 (TD-08): no WebLLM row may exist.
  assert.equal(data.rows.some((r) => /WebLLM/.test(r.benchmark)), false, 'no WebLLM row: the rung is cut from Sprint 4');
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
      const file = join(SIBLINGS, src.path);
      if (!existsSync(file)) continue; // sibling clone absent: skipped, never guessed
      const lines = readFileSync(file, 'utf8').split('\n');
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
  const sib = settledItems(LICENSING_SRC).flatMap((i) => i.sources).filter((x) => !x.path.startsWith('site/') && existsSync(join(SIBLINGS, x.path)));
  assert.ok(sib.length >= 10, 'sibling citations exist');
  const has = (x, frag) => readFileSync(join(SIBLINGS, x.path), 'utf8').includes(frag);
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

test('the home page repository table shows Sprint 3 and 4 statuses, not the Sprint 1 ones', () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  for (const stale of ['validator lands in Sprint 2', 'drivers and behavioural suite in Sprint 1', 'Sprint 1: specs, capability profile and asset manager', 'release preparation in progress', 'Skeleton; tests written']) {
    assert.ok(!html.includes(stale), `stale home status: ${stale}`);
  }
  const row = (repo) => new RegExp(`<tr><td>(?:<a [^>]*>)?${repo}(?:</a>)?</td>.*?</tr>`).exec(html)?.[0] ?? '';
  assert.match(row('glyphsift'), /Release candidate 0\.1\.0 \(not tagged, not published\)/);
  assert.match(row('runtime'), /Alpha 0\.2\.0-alpha\.1 \(not tagged, not published\)/);
  assert.match(row('runtime'), /WebLLM: not yet \(cut from Sprint 4\)/);
  assert.doesNotMatch(row('runtime'), /WebLLM is Sprint 4/);
  assert.match(row('localdata'), /0\.2\.0-alpha\.0/);
  assert.doesNotMatch(row('localdata'), /0\.1\.0-dev|lands in Sprint 4/);
  assert.match(row('pagetriage'), /not published, no tag yet/);
  assert.match(row('dockit'), /first working demo in Sprint 5/);
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
    assert.equal(r.laptop, 'not measured');
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
  assert.equal(text.split('\n')[0], readFileSync(join(root, '..', 'localdata', 'docs', 'benchmarks', 'vector-index.csv'), 'utf8').split('\n')[0], 'fixture header equals the real header');
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

test('importer: no CSV means both rows read not measured, in both columns, with no figure and no evidence', async () => {
  const { buildLocaldataRows } = await bench();
  const rows = buildLocaldataRows(undefined);
  assert.deepEqual(rows.map((r) => r.benchmark), [LABEL_256, LABEL_2048]);
  for (const r of rows) {
    assert.equal(r.dev, 'not measured');
    assert.equal(r.laptop, 'not measured');
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

test('benchmarks.json: the two localdata rows equal the importer output for the sibling CSV (or read not measured when there is none)', async () => {
  const { buildLocaldataRows, SIBLING_CSV } = await bench();
  const data = JSON.parse(readFileSync(join(root, 'data', 'benchmarks.json'), 'utf8'));
  const mine = data.rows.filter((r) => /^localdata flat index/.test(r.benchmark));
  assert.equal(mine.length, 2, 'both chunk-size rows must exist');
  assert.ok(/256-byte/.test(mine[0].benchmark) && /2,048-byte/.test(mine[1].benchmark));
  for (const r of mine) assert.equal(r.laptop, 'not measured');
  if (existsSync(SIBLING_CSV)) {
    assert.deepEqual(mine, buildLocaldataRows(readFileSync(SIBLING_CSV, 'utf8')), 'run: node scripts/import-localdata-bench.mjs');
  }
});

test('the built benchmarks page shows both localdata chunk-size rows, and every 8 GB cell in them reads not measured', () => {
  const { out } = buildToTemp();
  const html = readFileSync(join(out, 'benchmarks', 'index.html'), 'utf8');
  const rows = [...html.matchAll(/<tr><td>localdata flat index.*?<\/tr>/gs)].map((m) => m[0]);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /256-byte synthetic chunks/);
  assert.match(rows[1], /2,048-byte synthetic chunks/);
  for (const row of rows) {
    const cells = [...row.matchAll(/<td>(.*?)<\/td>/gs)].map((m) => m[1]);
    assert.equal(cells[4], 'not measured', 'the 8 GB Windows no-GPU laptop cell');
    assert.match(row, /npm run bench:vectors/);
    assert.match(row, /not measured on 8 GB/);
  }
});

// ---- Sprint 4 (D5-06): demos lines for dockit and site, the WebLLM wording, the spec wording, the gap-3 sweep (TD-11) ----

test('demos.json dockit line is a Sprint 4 line: contracts from runtime spec 0.4.0, the engine in a worker, WebLLM cut, no inference', () => {
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  const line = demos.find((d) => d.repo === 'dockit').status;
  const [claimed, notYet] = line.split(/Not yet: /);
  assert.ok(notYet, 'dockit line has a Not yet tail');
  assert.match(claimed, /plan and a prediction only/);
  assert.match(claimed, /runtime 0\.2\.0-alpha\.1 runs its engine in a worker/);
  assert.match(claimed, /[Cc]ontracts re-vendored from runtime spec release 0\.4\.0/);
  assert.match(claimed, /manifest spec v0\.1 published in runtime\/spec \(committed; public after the owner's push\)/);
  assert.match(claimed, /no inference until Sprint 5/);
  assert.doesNotMatch(claimed, /WebLLM/);
  assert.match(notYet, /a WebLLM rung \(cut from Sprint 4\)/);
  assert.doesNotMatch(line, /carried to Sprint 4/);
});

test('demos.json site line is a Sprint 4 line: the new papers, the localdata rows and the DevTools slots, derived from the data files', () => {
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  const papers = JSON.parse(readFileSync(join(root, 'data', 'papers.json'), 'utf8'));
  const bench = JSON.parse(readFileSync(join(root, 'data', 'benchmarks.json'), 'utf8'));
  const line = demos.find((d) => d.repo === 'site').status;
  assert.match(line, new RegExp(`paper tracker now ${papers.length} papers \\(${papers.length - 30} added, each checked against its primary page on 14 Nov 2026, all to-read\\)`));
  assert.match(line, /localdata vector-index rows \(256-byte and 2,048-byte chunks\) fed from localdata's benchmark CSV by an importer/);
  assert.match(line, /read not measured when that file is absent/);
  const timing = bench.rows.find((r) => /model-load timing per phase/i.test(r.benchmark));
  const slotsFilled = timing.dev !== 'not measured';
  if (slotsFilled) assert.match(line, /model-load timing and memory rows filled from the saved Sprint 3 DevTools figures/);
  else assert.match(line, /DevTools slots cut to Sprint 5/);
  assert.match(line, /8 GB laptop is not measured on 8 GB/);
  assert.match(line, /No scripts\.$/);
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

test('demos.json: runtime, localdata, pagetriage and glyphsift lines are the Sprint 4 texts, equal to their sources where a source file exists', () => {
  const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
  const line = (r) => demos.find((d) => d.repo === r)?.status ?? '';
  for (const r of ['runtime', 'localdata', 'pagetriage', 'glyphsift']) assert.ok(line(r).startsWith('Sprint 4 (14 Nov 2026)'), `${r}: not a Sprint 4 line`);
  const pt = join(SIBLINGS, 'pagetriage', 'site', 'index.html');
  if (existsSync(pt)) assert.equal(line('pagetriage'), /id="sprint-status">(.*?)<\/p>/s.exec(readFileSync(pt, 'utf8'))[1].trim());
  const statusRoot = process.env.DEMO_STATUS_SOURCES ?? join(SIBLINGS, 'evidence', 'sprint-4');
  for (const [r, f, name] of [['runtime', 'D1', 'status-line.txt'], ['glyphsift', 'D3', 'status-line.txt'], ['localdata', 'D4', 'status-line.txt'], ['dockit', 'D5', 'dockit-status-line.txt']]) {
    const src = join(statusRoot, f, name);
    if (existsSync(src)) assert.equal(line(r), readFileSync(src, 'utf8').trim(), `${r}: differs from ${f}/${name}`);
    else console.log(`skip: ${r} status source ${f}/${name} is absent under ${statusRoot === join(SIBLINGS, 'evidence', 'sprint-4') ? 'evidence/sprint-4' : 'DEMO_STATUS_SOURCES'}`);
  }
  assert.match(line('runtime'), /manifest spec v0\.1 published in runtime\/spec \(committed; public after the owner's push\)/);
  assert.match(line('runtime'), /WebLLM \(cut from Sprint 4\)/);
  for (const r of ['runtime', 'localdata', 'pagetriage', 'glyphsift']) assert.doesNotMatch(line(r), /carried to Sprint 4|lands in Sprint 4|reports not_implemented/, `${r}: stale`);
});

test('home page repository table: runtime 0.2.0-alpha.1, localdata 0.2.0-alpha.0 with a flat vector index in OPFS (not measured on 8 GB)', () => {
  const html = readFileSync(join(root, 'src', 'pages', 'index.html'), 'utf8').replace(/\s+/g, ' ');
  const row = (n) => new RegExp(`<tr><td><a [^>]*>${n}</a></td>.*?</tr>`).exec(html)?.[0] ?? '';
  assert.match(row('runtime'), /0\.2\.0-alpha\.1/);
  assert.doesNotMatch(row('runtime'), /0\.2\.0-alpha\.0/);
  assert.match(row('localdata'), /0\.2\.0-alpha\.0/);
  assert.match(row('localdata'), /flat vector index persisted in OPFS \(not measured on 8 GB\)/);
  assert.doesNotMatch(row('localdata'), /lands in Sprint 4/);
});
