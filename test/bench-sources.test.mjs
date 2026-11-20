// Owner decision, 20 Nov 2026: every figure on the benchmarks page is the figure of a row in a raw file that the owning repository has COMMITTED under
// docs/benchmarks/, the row says when it was measured, on which commit and on which machine, and the page links to the file.
//
// These tests read the sibling files through the committed fixtures (what CI does) or, under `npm run test:siblings`, through the live clones, and run
// scripts/bench-sources.mjs over data/benchmarks.json. They fail when a figure disagrees with the file, and the mutation tests below show that they do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build.mjs';
import { NOT_MEASURED, RAW_PATH, checkRows, describeSource, figureRows, rawPaths, rawUrl, splitRaw } from '../scripts/bench-sources.mjs';
import { SOURCE_JSON, readSibling } from '../scripts/sibling-fixtures.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'data', 'benchmarks.json'), 'utf8'));
const read = (repo, path) => readSibling(repo, path);
const clone = (x) => structuredClone(x);
const rowById = (rows, id) => rows.find((r) => r.id === id);

const FIGURE_IDS = ['runtime-webgpu-vs-wasm', 'runtime-load-phases', 'runtime-load-memory', 'glyphsift-throughput', 'glyphsift-score-vs-noise', 'localdata-flat-256', 'localdata-flat-2048'];

test('benchmarks.json: every figure is the figure of a raw file its repository committed, with the same date, commit, machine and command', () => {
  const problems = checkRows(data.rows, read);
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('benchmarks.json: the figure rows are the ones this page shows, and every other row quotes no figure and cites no evidence', () => {
  assert.deepEqual(figureRows(data.rows).map((r) => r.id), FIGURE_IDS);
  for (const r of data.rows.filter((x) => x.dev === NOT_MEASURED)) {
    assert.equal(r.evidence, undefined, `${r.benchmark}: reads not measured and cites evidence`);
    assert.equal(r.measured, undefined, `${r.benchmark}: reads not measured and has a measured block`);
    assert.equal(r.laptop, 'not measured on 8 GB');
  }
  // the 8 GB cell reads not measured on 8 GB in every row, figure or not
  for (const r of data.rows) assert.equal(r.laptop, 'not measured on 8 GB', r.benchmark);
});

test('benchmarks.json: no row rests on a workspace evidence log any more; every figure cites raw files of a sibling only', () => {
  for (const r of figureRows(data.rows)) {
    assert.doesNotMatch(r.evidence, /evidence\/sprint-/, `${r.id}: a workspace evidence path`);
    assert.ok(rawPaths(r.evidence).length >= 1, r.id);
    for (const p of rawPaths(r.evidence)) assert.match(p, /^(pagetriage|glyphsift|localdata|runtime|dockit)\/docs\/benchmarks\/[A-Za-z0-9._-]+$/, p);
  }
});

test('the glyphsift rows are repointed to glyphsift/docs/benchmarks, with the figures of the committed files (238 ms, 81 ms, 66 ms) and not the Sprint 2 ones', () => {
  const t = rowById(data.rows, 'glyphsift-throughput');
  assert.equal(t.evidence, 'glyphsift/docs/benchmarks/throughput-m5pro-48gb.json');
  assert.match(t.dev, /native glyphsift check: 66 ms; WASM validate\(\): 238 ms; WASM score_ppm\(\): 81 ms$/);
  assert.doesNotMatch(t.dev, /\b232 ms|\b75 ms|0\.05 to 0\.06 s|0\.17 s/, 'a Sprint 2 figure with no commit is still in the row');
  assert.deepEqual(t.measured, { date: '2026-11-20', commit: '3c0bb4dcc0a5', machine: 'Apple M5 Pro, 48 GB', recordedIn: t.evidence });
  const s = rowById(data.rows, 'glyphsift-score-vs-noise');
  assert.equal(s.evidence, 'glyphsift/docs/benchmarks/score-vs-noise.csv and glyphsift/docs/benchmarks/score-vs-noise.provenance.json');
  assert.equal(s.measured.commit, '3c0bb4dcc0a5');
  assert.equal(s.measured.recordedIn, 'glyphsift/docs/benchmarks/score-vs-noise.provenance.json');
});

test('the runtime rows quote the one run runtime commits; the independent T1 run, which has no committed row, is no longer shown', () => {
  for (const id of ['runtime-load-phases', 'runtime-load-memory']) {
    const r = rowById(data.rows, id);
    assert.equal(r.evidence, 'runtime/docs/benchmarks/devtools-load-phases.json');
    assert.match(r.dev, /One headed run:/);
    assert.doesNotMatch(r.dev, /T1 run|D1 run/);
    assert.match(r.notes, /second, independent (headed )?run was quoted on this page before/);
    assert.match(r.notes, /runtime does not commit its raw output/);
    assert.deepEqual(r.measured, { date: '2026-11-14', commit: 'not recorded (base 15c6d58)', machine: 'Apple M5 Pro 48 GB', recordedIn: r.evidence });
  }
  for (const stale of ['1,254', '664.9', '7.4 ms', '479.7', '655.5', '3,587,929', '33,865,195', '33,954,615']) {
    assert.ok(!data.rows.some((r) => `${r.dev} ${r.notes}`.includes(stale)), `the uncommitted T1 figure ${stale} is still on the page`);
  }
  const w = rowById(data.rows, 'runtime-webgpu-vs-wasm');
  assert.equal(w.evidence, 'runtime/docs/benchmarks/model-answer-smollm2.json');
  assert.equal(w.measured.commit, 'not recorded (base c2b6166)');
});

test('the localdata rows carry the date, commit and machine of vector-index.csv, and link it', () => {
  for (const id of ['localdata-flat-256', 'localdata-flat-2048']) {
    const r = rowById(data.rows, id);
    assert.equal(r.evidence, 'localdata/docs/benchmarks/vector-index.csv');
    assert.deepEqual(r.measured, { date: '2026-11-14', commit: '0390d65-dirty', machine: 'Apple M5 Pro, 48 GB', recordedIn: r.evidence });
  }
});

test('describeSource: reads the envelope of a glyphsift file and the commit note of a runtime file', () => {
  assert.deepEqual(describeSource('glyphsift/docs/benchmarks/throughput-m5pro-48gb.json', read), {
    date: '2026-11-20',
    commit: '3c0bb4dcc0a5',
    machine: 'Apple M5 Pro, 48 GB',
    commands: ['node scripts/throughput.mjs corpus-1mib.txt --cli target/release/glyphsift --json docs/benchmarks/throughput-m5pro-48gb.json'],
  });
  const rt = describeSource('runtime/docs/benchmarks/model-answer-smollm2.json', read);
  assert.equal(rt.commit, 'not recorded (base c2b6166)');
  assert.ok(rt.commands.includes('RUNTIME_MODEL=1 RUNTIME_REQUIRE_WEBGPU=1 npm run test:model'), 'the output-folder variable is left out of the command');
  assert.throws(() => describeSource('localdata/docs/benchmarks/vector-index.csv', read), /no reader/);
});

test('every raw file a figure cites has a fixture cut from a commit of its repository, never from a working tree', () => {
  const src = JSON.parse(readFileSync(SOURCE_JSON, 'utf8'));
  for (const r of figureRows(data.rows)) {
    for (const p of rawPaths(r.evidence)) {
      const [repo, rest] = splitRaw(p);
      const entry = src.files.find((f) => f.repo === repo && f.path === rest);
      assert.ok(entry, `${p}: no fixture entry in SOURCE.json (node scripts/make-sibling-fixtures.mjs)`);
      assert.match(String(entry.commit), /^[0-9a-f]{40}$/, `${p}: cut from the working tree, not a commit; commit the file in ${repo} and re-cut`);
      assert.equal(entry.cut.mode, 'whole', p);
    }
  }
});

// ---- the checks fail when a figure disagrees: each mutation of a row, or of a file, is reported ----

test('mutation: a changed figure in a row is reported, for every figure row', () => {
  for (const id of FIGURE_IDS) {
    const rows = clone(data.rows);
    const r = rowById(rows, id);
    const first = /\d[\d,.]*/.exec(r.dev);
    assert.ok(first, `${id}: no figure in the row`);
    r.dev = r.dev.replace(first[0], String(Number(first[0].replace(/,/g, '')) + 1));
    const problems = checkRows(rows, read);
    assert.ok(problems.length >= 1, `${id}: a changed figure was not reported`);
    assert.match(problems.join('\n'), new RegExp(id));
  }
});

test('mutation: the Sprint 2 figures that were on the page (232 ms, 75 ms) are reported if they come back', () => {
  const rows = clone(data.rows);
  const t = rowById(rows, 'glyphsift-throughput');
  t.dev = 'native CLI: 0.05 to 0.06 s (one cold run 0.17 s); WASM validate(): 232 ms; WASM score_ppm(): 75 ms';
  assert.match(checkRows(rows, read).join('\n'), /glyphsift-throughput: the figure is not the committed one/);
});

test('mutation: a wrong date, commit, machine or command beside a figure is reported', () => {
  for (const [id, key, value] of [
    ['glyphsift-throughput', 'date', '2026-11-19'],
    ['glyphsift-throughput', 'commit', 'deadbeef0000'],
    ['glyphsift-throughput', 'machine', 'Apple M5 Pro 48 GB'],
    ['glyphsift-score-vs-noise', 'commit', '3c0bb4dcc0a4'],
    ['runtime-webgpu-vs-wasm', 'commit', 'c2b6166'],
    ['runtime-load-phases', 'date', '2026-11-15'],
    ['localdata-flat-256', 'commit', '8abd87b'],
  ]) {
    const rows = clone(data.rows);
    rowById(rows, id).measured[key] = value;
    assert.ok(checkRows(rows, read).length >= 1, `${id}: a wrong ${key} was not reported`);
  }
  const rows = clone(data.rows);
  rowById(rows, 'glyphsift-throughput').command = 'target/release/glyphsift check corpus-1mib.txt';
  assert.match(checkRows(rows, read).join('\n'), /command .* is none of the file's commands/);
});

test('mutation: a figure row with no id, no measured block, no raw file, a file that is not there or another file than its own is reported', () => {
  const cases = [
    (r) => delete r.id,
    (r) => delete r.measured,
    (r) => delete r.evidence,
    (r) => (r.evidence = 'evidence/sprint-2/D3/throughput.log'),
    (r) => (r.evidence = 'glyphsift/docs/benchmarks/not-a-file.json'),
    (r) => (r.evidence = 'glyphsift/docs/benchmarks/score-vs-noise.csv'),
    (r) => (r.measured.recordedIn = 'glyphsift/docs/benchmarks/score-vs-noise.provenance.json'),
    (r) => (r.laptop = '1,000 ms'),
  ];
  for (const [i, mutate] of cases.entries()) {
    const rows = clone(data.rows);
    mutate(rowById(rows, 'glyphsift-throughput'));
    assert.ok(checkRows(rows, read).length >= 1, `case ${i} was not reported`);
  }
});

test('mutation: a new figure with no recomputation, and a row that reads not measured but cites evidence, are reported', () => {
  const rows = clone(data.rows);
  rows.push({ id: 'pagetriage-new', benchmark: 'x', repo: 'pagetriage', command: 'cargo bench', dev: '12 ms', laptop: 'not measured on 8 GB', evidence: 'pagetriage/docs/benchmarks/claims.json', measured: { date: '2026-11-20', commit: 'abc', machine: 'm', recordedIn: 'pagetriage/docs/benchmarks/claims.json' } });
  assert.match(checkRows(rows, read).join('\n'), /pagetriage-new: no recomputation of this figure/);
  const rows2 = clone(data.rows);
  rows2.find((r) => r.dev === NOT_MEASURED).evidence = 'runtime/docs/benchmarks/asset-download-700mb.json';
  assert.match(checkRows(rows2, read).join('\n'), /reads not measured but cites evidence/);
});

test('mutation: when the sibling commits a different file, the unchanged row fails (a figure that disagrees with the sibling file fails)', () => {
  const alter = (repo, path, fn) => (r, p) => {
    const text = read(r, p);
    return r === repo && p === path ? fn(text) : text;
  };
  const cases = [
    ['glyphsift-throughput', alter('glyphsift', 'docs/benchmarks/throughput-m5pro-48gb.json', (t) => t.replace('"best_ms": 238', '"best_ms": 239'))],
    ['glyphsift-score-vs-noise', alter('glyphsift', 'docs/benchmarks/score-vs-noise.csv', (t) => t.replace('mixed,0.4,1,6305,519,935924,', 'mixed,0.4,1,6305,519,938924,'))],
    ['glyphsift-throughput', alter('glyphsift', 'docs/benchmarks/throughput-m5pro-48gb.json', (t) => t.replace('3c0bb4dcc0a53bb5d87c4971d1c6e1e30b109e39', '4c0bb4dcc0a53bb5d87c4971d1c6e1e30b109e39'))],
    ['runtime-webgpu-vs-wasm', alter('runtime', 'docs/benchmarks/model-answer-smollm2.json', (t) => t.replace('"loadMs": 2667', '"loadMs": 2668'))],
    ['runtime-load-phases', alter('runtime', 'docs/benchmarks/devtools-load-phases.json', (t) => t.replace('"acquire": 1260.9,', '"acquire": 1261.9,'))],
    ['runtime-load-memory', alter('runtime', 'docs/benchmarks/devtools-load-phases.json', (t) => t.replaceAll('79,554,898 B', '79,554,899 B'))],
    ['localdata-flat-256', alter('localdata', 'docs/benchmarks/vector-index.csv', (t) => t.replace(/(opfs,simd,100000,384,256,false,1,[^,]*,[^,]*,[^,]*,)([0-9.]+)/, (_m, a, b) => `${a}${Number(b) + 40}`))],
  ];
  for (const [id, reader] of cases) {
    const problems = checkRows(data.rows, reader);
    assert.ok(problems.some((p) => p.startsWith(id)), `${id}: an altered committed file was not reported (${problems.join(' | ') || 'no problem'})`);
  }
  // the provenance file must describe the CSV it sits next to
  const problems = checkRows(data.rows, (r, p) => (p === 'docs/benchmarks/score-vs-noise.provenance.json' ? read(r, p).replace(/"csv_sha256": "[0-9a-f]{64}"/, `"csv_sha256": "${'0'.repeat(64)}"`) : read(r, p)));
  assert.match(problems.join('\n'), /csv_sha256 is not the hash of score-vs-noise\.csv/);
});

// ---- the page ----

test('the built benchmarks page links every raw file of a figure on GitHub and says when, on which commit and on which machine it was measured', () => {
  const out = mkdtempSync(join(tmpdir(), 'amlabs-site-bench-'));
  build({ root, outDir: out });
  const html = readFileSync(join(out, 'benchmarks', 'index.html'), 'utf8');
  for (const r of figureRows(data.rows)) {
    for (const p of rawPaths(r.evidence)) {
      assert.ok(html.includes(`<a href="${rawUrl(p)}" rel="noopener noreferrer">${p}</a>`), `${r.id}: no link to ${p}`);
      assert.match(rawUrl(p), /^https:\/\/github\.com\/AirplaneMode-Labs\/(pagetriage|glyphsift|localdata|runtime|dockit)\/blob\/main\/docs\/benchmarks\/[A-Za-z0-9._-]+$/);
    }
    const m = r.measured;
    assert.ok(html.includes(`Measured ${m.date}, commit ${m.commit}, ${m.machine}.`), `${r.id}: the measured line is not on the page`);
    // the stale text form of the evidence is gone
    assert.ok(!html.includes(`Evidence: ${r.evidence}.`), `${r.id}: the evidence is plain text, not links`);
  }
  for (const repo of ['pagetriage', 'glyphsift', 'localdata', 'runtime', 'dockit']) {
    assert.ok(html.includes(`<a href="https://github.com/AirplaneMode-Labs/${repo}/tree/main/docs/benchmarks" rel="noopener noreferrer">${repo}</a>`), `no link to the ${repo} folder`);
  }
  assert.match(html, /Raw results, one folder per repository, each with an index saying what every file is/);
  // a path in the evidence is matched whole: a trailing full stop of the sentence is not part of the file name
  assert.deepEqual(rawPaths('glyphsift/docs/benchmarks/a.json and runtime/docs/benchmarks/b-c_d.json.'), ['glyphsift/docs/benchmarks/a.json', 'runtime/docs/benchmarks/b-c_d.json']);
  assert.equal(RAW_PATH.global, true);
});
