import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build, checkEmulated, renderEmulated } from '../scripts/build.mjs';
import { buildEmulated, importEmulated, serialise, validateEnvironmentLabel, limitProof, proofRow, EVIDENCE_COLUMNS, LIMIT_PROOF_TEXT, MACHINE_8GB_OR_LAPTOP_RE, ENVIRONMENT_RE, EMULATED_SPEC, NOT_MEASURED_8GB } from '../scripts/import-dockit-emulated.mjs';

// Sprint 7 (B6, TD-113): the benchmarks page gets a section for the emulated Windows run, built only from data/e2e-emulated.json, which the importer
// writes only when dockit's emulated CSV exists. No data, no section and no 'emulated' text on the benchmarks page; with data, the label verbatim.
// Every cell is checked on the way in and HTML-escaped on the way out; the laptop cells of the page are not touched.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(root, 'test', 'fixtures');

import { COLUMNS, GIB, MIB, SAMPLE, cell, hostileData, label } from '../scripts/make-emulated-fixtures.mjs';
const sha256 = (t) => createHash('sha256').update(t).digest('hex');

/** A site root without data/e2e-emulated.json (or with the given JSON text there), built to a temp folder. */
function buildCopy(emulatedJson) {
  const tmp = mkdtempSync(join(tmpdir(), 'amlabs-site-emu-'));
  const copy = join(tmp, 'site');
  mkdirSync(copy);
  for (const d of ['src', 'data', 'writeups', 'brand']) cpSync(join(root, d), join(copy, d), { recursive: true });
  rmSync(join(copy, 'data', 'e2e-emulated.json'), { force: true });
  if (emulatedJson !== undefined) writeFileSync(join(copy, 'data', 'e2e-emulated.json'), emulatedJson);
  const out = join(tmp, 'dist');
  build({ root: copy, outDir: out });
  return { out, html: readFileSync(join(out, 'benchmarks', 'index.html'), 'utf8'), tmp };
}

test('importer: every leg of the sample CSV becomes one group, with the label verbatim and the figures computed, not typed', () => {
  const d = buildEmulated(SAMPLE.e2e, SAMPLE.q);
  assert.equal(d.spec, EMULATED_SPEC);
  assert.equal(d.legs.length, 4);
  assert.deepEqual(d.legs.map((l) => l.limitBytes), [null, 8 * GIB, 6 * GIB, 5 * GIB]);
  assert.deepEqual(d.legs.map((l) => l.environment), [label(null), label(8), label(6), label(5)]);
  const six = d.legs[2];
  assert.equal(six.runs, 6);
  assert.equal(six.sessionRuns, 5);
  assert.equal(six.restartRuns, 1);
  assert.equal(six.jobCommitPeakBytes, 4800 * MIB);
  // every row of the leg counts, the restart run too: no run is selected (the six rows add 1 to 6 MiB to the Chrome-only peak of 4500 MiB)
  assert.deepEqual(six.processCommitPeakBytes, { median: 4500 * MIB + 3.5 * MIB, worst: 4500 * MIB + 6 * MIB });
  assert.equal(six.jobEscapes, 0);
  assert.equal(six.result, 'pass');
  assert.equal(six.laptop8gb, NOT_MEASURED_8GB);
  assert.equal(d.legs[3].result, 'fail');
  assert.equal(d.legs[3].failure, 'out_of_memory');
  assert.equal(d.legs[0].limitBytes, null);
  assert.equal(d.source.csvSha256, sha256(SAMPLE.e2e));
  assert.equal(d.source.questionsCsvSha256, sha256(SAMPLE.q));
});

test('importer: a leg with fewer than five in-session runs and a restart run, and no failure, is incomplete, never pass', () => {
  const lines = SAMPLE.e2e.trim().split('\n');
  // keep the none leg's header and its first three rows only
  const cut = [lines[0], ...lines.slice(1).filter((l) => l.includes(label(null))).slice(0, 3)].join('\n') + '\n';
  const d = buildEmulated(cut);
  assert.equal(d.legs.length, 1);
  assert.equal(d.legs[0].result, 'incomplete');
});

test('importer: the committed sample fixture is the importer output for the invented rows, and the CSV fixtures are what the test builds', () => {
  const fixture = JSON.parse(readFileSync(join(FIX, 'e2e-emulated.sample.json'), 'utf8'));
  assert.deepEqual(fixture, buildEmulated(SAMPLE.e2e, SAMPLE.q));
  assert.equal(readFileSync(join(FIX, 'e2e-emulated.sample.csv'), 'utf8'), SAMPLE.e2e);
  assert.equal(readFileSync(join(FIX, 'e2e-emulated-questions.sample.csv'), 'utf8'), SAMPLE.q);
  assert.equal(readFileSync(join(FIX, 'e2e-emulated.hostile.json'), 'utf8'), serialise(hostileData()));
  assert.match(readFileSync(join(FIX, 'README.md'), 'utf8'), /e2e-emulated\.sample/);
});

const mutate = (col, value, rowIndex = 0) => {
  const lines = SAMPLE.e2e.trim().split('\n');
  const rows = lines.slice(1).map((l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '')));
  const i = COLUMNS.indexOf(col);
  rows[rowIndex][i] = cell(value);
  return `${lines[0]}\n${rows.map((r) => r.join(',')).join('\n')}\n`;
};

test('importer refuses an environment that is not "emulated: ...; not a laptop", or names a laptop elsewhere, or reads as an 8 GB machine', () => {
  for (const bad of ['Apple M5 Pro 48 GB', 'emulated: VM', 'emulated: laptop VM; not a laptop', 'emulated: VM with 8 GB RAM; not a laptop', 'emulated: <script>alert(1)</script>; not a laptop', 'emulated: VM "onerror=alert(1); not a laptop', 'emulated: =HYPERLINK("http://x","y"); not a laptop', '']) {
    assert.throws(() => buildEmulated(mutate('environment', bad)), /environment label|environment/, bad);
  }
  assert.ok(ENVIRONMENT_RE.test(label(6)));
  assert.ok(!ENVIRONMENT_RE.test('emulated: x\n; not a laptop'));
});

test('importer refuses numeric columns that are not non-negative integers', () => {
  for (const col of ['job_commit_peak_bytes', 'process_commit_peak_bytes', 'job_escapes', 'sampler_median_interval_ms', 'process_rss_peak_bytes', 'total_ms']) {
    for (const bad of ['-1', '1.5', '1e9', 'abc', '0x10', '=1+1', '<b>1</b>']) {
      assert.throws(() => buildEmulated(mutate(col, bad)), /not a non-negative integer|must be/, `${col} = ${bad}`);
    }
  }
});

test('importer refuses laptop_8gb that is not exactly "not measured on 8 GB", a bad failure_reason, a missing column and a hostile question row', () => {
  assert.throws(() => buildEmulated(mutate('laptop_8gb', 'measured')), /laptop_8gb must read 'not measured on 8 GB'/);
  assert.throws(() => buildEmulated(mutate('laptop_8gb', '')), /laptop_8gb/);
  assert.throws(() => buildEmulated(mutate('failure_reason', '<script>')), /failure_reason/);
  assert.throws(() => buildEmulated(mutate('failure_reason', 'because')), /failure_reason/);
  assert.throws(() => buildEmulated(SAMPLE.e2e.replace(',job_escapes,', ',escapes,')), /column job_escapes is missing/);
  const q = SAMPLE.q.replace(`,${NOT_MEASURED_8GB},`, ',nope,');
  assert.throws(() => buildEmulated(SAMPLE.e2e, q), /laptop_8gb/);
  const hostileQ = SAMPLE.q.replace(label(null), 'emulated: <img src=x onerror=1>; not a laptop');
  assert.throws(() => buildEmulated(SAMPLE.e2e, hostileQ), /environment/);
});

test('importer: with no emulated CSV it writes nothing, and says so', () => {
  const dir = mkdtempSync(join(tmpdir(), 'amlabs-emu-in-'));
  const out = join(dir, 'e2e-emulated.json');
  const r = importEmulated({ dir, out });
  assert.equal(r.written, false);
  assert.equal(r.reason, 'no emulated CSV');
  assert.equal(existsSync(out), false);
});

test('importer: with the CSV it writes the JSON once and is idempotent; --check style: a second run changes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'amlabs-emu-in-'));
  writeFileSync(join(dir, 'e2e-emulated-win-vm.csv'), SAMPLE.e2e);
  writeFileSync(join(dir, 'e2e-emulated-win-vm-questions.csv'), SAMPLE.q);
  const out = join(dir, 'e2e-emulated.json');
  const a = importEmulated({ dir, out });
  assert.equal(a.written, true);
  assert.equal(a.changed, true);
  const b = importEmulated({ dir, out });
  assert.equal(b.changed, false);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), buildEmulated(SAMPLE.e2e, SAMPLE.q, { csvName: 'docs/benchmarks/e2e-emulated-win-vm.csv', questionsName: 'docs/benchmarks/e2e-emulated-win-vm-questions.csv' }));
  assert.equal(importEmulated({ dir, out, write: false }).changed, false);
});

test('importer: a questions CSV without its runs CSV is refused, and the laptop CSV is never read as an emulated file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'amlabs-emu-in-'));
  writeFileSync(join(dir, 'e2e-emulated-win-vm-questions.csv'), SAMPLE.q);
  assert.throws(() => importEmulated({ dir, out: join(dir, 'x.json') }), /e2e-emulated-win-vm\.csv/);
  const dir2 = mkdtempSync(join(tmpdir(), 'amlabs-emu-in-'));
  writeFileSync(join(dir2, 'e2e.csv'), SAMPLE.e2e);
  assert.equal(importEmulated({ dir: dir2, out: join(dir2, 'x.json') }).written, false);
});

// ---- the page ----

test('no data file: the benchmarks page has no emulated section and no "emulated" text at all', () => {
  const { html, out } = buildCopy(undefined);
  assert.doesNotMatch(html, /emulated/i);
  assert.doesNotMatch(html, /id="emulated-windows"/);
  assert.doesNotMatch(readFileSync(join(out, 'benchmarks', 'index.html'), 'utf8'), /\bnot a laptop\b/);
});

test('the real site root today: data/e2e-emulated.json exists if and only if dockit has committed emulated results, and the page follows the file', () => {
  const real = existsSync(join(root, 'data', 'e2e-emulated.json'));
  const out = mkdtempSync(join(tmpdir(), 'amlabs-site-real-'));
  build({ root, outDir: out });
  const html = readFileSync(join(out, 'benchmarks', 'index.html'), 'utf8');
  assert.equal(/id="emulated-windows"/.test(html), real);
  if (!real) assert.doesNotMatch(html, /emulated/i);
});

test('with the sample fixture: the section names the label verbatim, the pwsh, node and Chrome process tree, "not a laptop", the commit peaks and a result per cap', () => {
  const sample = readFileSync(join(FIX, 'e2e-emulated.sample.json'), 'utf8');
  const data = JSON.parse(sample);
  const { html } = buildCopy(sample);
  const section = /<h2 id="emulated-windows">[\s\S]*?(?=<h2 id="memory-hardening">|<h2 id="vector-search">|<h2>Reference machine<\/h2>|$)/.exec(html)?.[0] ?? '';
  assert.ok(section.length > 800, 'the emulated section is missing');
  assert.match(section, /<h2 id="emulated-windows">Emulated on a GitHub-hosted Windows VM \(not a laptop\)<\/h2>/);
  for (const l of data.legs) assert.ok(section.includes(`<td>${l.environment}</td>`), `the label is verbatim: ${l.environment}`);
  assert.ok(section.includes('pwsh, node and Chrome process tree'));
  assert.ok(section.includes('not a laptop'));
  for (const th of ['Environment', 'Job commit limit', 'Peak commit, whole tree', 'Peak commit, Chrome only', 'Result', '8 GB laptop']) assert.ok(section.includes(`<th>${th}`), `column ${th}`);
  const mib = (b) => `${Math.round(b / MIB).toLocaleString('en-US')} MiB`;
  const rows = [...section.matchAll(/<tr class="emulated-leg"[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  assert.equal(rows.length, 4);
  for (const [i, r] of rows.entries()) {
    const l = data.legs[i];
    assert.ok(r.includes(mib(l.jobCommitPeakBytes)), 'whole-tree peak');
    assert.ok(r.includes(mib(l.processCommitPeakBytes.worst)), 'Chrome-only peak');
    assert.ok(r.includes(l.limitBytes === null ? 'no limit' : `${l.limitBytes / GIB} GiB`), 'the limit');
    assert.ok(r.includes(l.result === 'pass' ? '>pass<' : l.result === 'fail' ? 'fail: out_of_memory' : 'incomplete'), 'pass or fail per cap');
    assert.ok(r.includes('<td>not measured on 8 GB</td>'), 'the 8 GB laptop cell');
  }
  assert.ok(rows[3].includes('fail: out_of_memory'));
  // the done-when is not called met, and no emulated figure is called an 8 GB or laptop figure
  assert.doesNotMatch(section.replaceAll('NOT met', ''), /\bmet\b/);
  assert.match(section, /done-when[^.]*NOT met|NOT met[^.]*done-when/i);
  assert.doesNotMatch(section.replaceAll('not a laptop', '').replaceAll(/<td>emulated: [^<]*<\/td>/g, ''), /laptop result|8 GB result/i);
});

test('with the sample fixture: the rest of the benchmarks page is byte for byte what it is without it (the laptop cells are untouched)', () => {
  const sample = readFileSync(join(FIX, 'e2e-emulated.sample.json'), 'utf8');
  const without = buildCopy(undefined).html;
  const withData = buildCopy(sample).html;
  const section = /<h2 id="emulated-windows">[\s\S]*?(?=<h2 id="memory-hardening">|<h2 id="vector-search">|<h2>Reference machine<\/h2>)/.exec(withData)?.[0];
  assert.ok(section);
  assert.equal(withData.replace(section, ''), without);
  assert.ok(without.includes('Apple M5 Pro 48 GB'));
});

test('the hostile fixture is refused at build time, and a render that bypasses the check escapes every cell', () => {
  const hostile = readFileSync(join(FIX, 'e2e-emulated.hostile.json'), 'utf8');
  for (const needle of ['<script>', '"onerror=', '=HYPERLINK(']) assert.ok(hostile.includes(needle), `the hostile fixture holds ${needle}`);
  assert.throws(() => buildCopy(hostile), /environment label|failure|not a non-negative integer|laptop_8gb/);
  assert.throws(() => checkEmulated(JSON.parse(hostile)), /environment label|failure|not a non-negative integer|laptop_8gb/);
  const html = renderEmulated(JSON.parse(hostile));
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /"onerror=/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&quot;onerror=/);
  // a spreadsheet formula is text in an HTML cell, never a link or a form
  assert.doesNotMatch(html, /<a |<form|<img|<iframe/);
});

// The first Windows run (dockit's bench-windows run 44656249868, 20 Nov 2026): the 5 GiB leg's own whole-tree peak was above its limit and no leg failed, so the
// section says in words, computed from the data and never typed, what the legs do and do not show, next to the figures.
const sampleData = () => JSON.parse(readFileSync(join(FIX, 'e2e-emulated.sample.json'), 'utf8'));
/** The sample with the 5 GiB leg completed (no failure) and its whole-tree peak set, as the first real run looked: no limit evidence at all, so every capped leg is unproven, and no control leg. */
function firstRunShape(peakMiB) {
  const d = sampleData();
  d.controlLegs = [];
  for (const l of d.legs) {
    l.limitProof = l.limitBytes === null ? 'no_limit' : 'unproven';
    l.limitReadBack = null;
    l.probeRefused = null;
    l.peakAfterProbeBytes = null;
    l.limitMessages = null;
  }
  const five = d.legs[3];
  five.failure = null;
  five.result = 'pass';
  five.runs = 6;
  five.sessionRuns = 5;
  five.restartRuns = 1;
  five.jobCommitPeakBytes = peakMiB * MIB;
  return d;
}
const sectionOf = (data) => renderEmulated(data);

test('a leg whose whole-tree peak is above its own limit is called not a result under that cap, in words and in its Result cell', () => {
  const html = sectionOf(firstRunShape(5793));
  assert.ok(html.includes('<strong>The 5 GiB leg is not a result under a 5 GiB cap.</strong>'));
  // 5,793 MiB against 5,120 MiB: 673 MiB above, every number from the data
  assert.ok(html.includes('Its whole-tree peak is 5,793 MiB, 673 MiB above its job commit limit of 5,120 MiB'));
  assert.ok(html.includes('PeakJobMemoryUsed'));
  assert.ok(html.includes('the figures of this run cannot say which'));
  const rows = [...html.matchAll(/<tr class="emulated-leg"[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  assert.ok(rows[3].includes('pass (whole-tree peak above the limit: not a result under this cap)'));
  for (const r of rows.slice(0, 3)) assert.ok(!r.includes('above the limit'));
  assert.equal(html.match(/is not a result under a /g).length, 1);
});

test('with no leg failed, the capped legs are said to show no limit taking effect; a failed leg, or no capped leg, removes that sentence', () => {
  const sentence = 'No leg in this file failed for want of memory';
  const none = 'none of the capped legs shows the limit taking effect';
  const quiet = sectionOf(firstRunShape(4900));
  assert.ok(quiet.includes(`${sentence}, so ${none}`));
  assert.ok(quiet.includes('read the capped legs as the same run with the limit unproven'));
  assert.ok(!quiet.includes('is not a result under a '), 'a leg below its limit is not called above it');
  assert.ok(!sectionOf(sampleData()).includes(sentence), 'the sample has a failed leg');
  const uncappedOnly = sampleData();
  uncappedOnly.legs = [uncappedOnly.legs[0]];
  assert.ok(!sectionOf(uncappedOnly).includes(sentence));
  assert.ok(!sectionOf(uncappedOnly).includes('unproven'));
});

test('the section says each leg ran on its own runner VM (only when there is more than one leg), and still quotes every label verbatim', () => {
  const html = sectionOf(firstRunShape(5793));
  assert.ok(html.includes('Each leg ran on its own runner VM'));
  assert.ok(html.includes('is not an effect of the cap'));
  assert.ok(html.includes('scripts/win/README.md'));
  const one = sampleData();
  one.legs = [one.legs[0]];
  assert.ok(!sectionOf(one).includes('Each leg ran on its own runner VM'));
  for (const l of firstRunShape(5793).legs) assert.ok(html.includes(`<td>${l.environment}</td>`));
});

test('the reading never says a leg met, passed under, survived or worked under a cap, and never calls an emulated figure a laptop result', () => {
  for (const data of [firstRunShape(5793), firstRunShape(4900), sampleData()]) {
    const html = sectionOf(data);
    assert.doesNotMatch(html.replaceAll('NOT met', ''), /\bmet\b/);
    assert.doesNotMatch(html, /works? under|survives?|passes? under|within the cap/i);
    assert.doesNotMatch(html.replaceAll('not a laptop', '').replaceAll(/<td>emulated: [^<]*<\/td>/g, ''), /laptop result|8 GB result/i);
  }
});

test('the committed data, when it exists, is dockit\'s first Windows run: four legs in matrix order, six runs each, and the page says what the 5 GiB leg does not show', () => {
  const file = join(root, 'data', 'e2e-emulated.json');
  if (!existsSync(file)) return;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  assert.doesNotThrow(() => checkEmulated(data));
  assert.deepEqual(data.legs.map((l) => l.limitBytes), [null, 8 * GIB, 6 * GIB, 5 * GIB]);
  assert.deepEqual(data.legs.map((l) => l.runs), [6, 6, 6, 6]);
  assert.deepEqual(data.legs.map((l) => l.result), ['pass', 'pass', 'pass', 'pass']);
  assert.ok(data.legs.every((l) => l.laptop8gb === NOT_MEASURED_8GB && l.jobEscapes === 0 && l.failure === null));
  assert.ok(data.legs[3].jobCommitPeakBytes > data.legs[3].limitBytes, 'the 5 GiB leg is above its own limit');
  for (const l of data.legs.slice(0, 3)) assert.ok(l.limitBytes === null || l.jobCommitPeakBytes < l.limitBytes);
  assert.equal(data.source.commit, '5705baab8cdf');
  // written before the limit evidence existed: no read-back, no probe, no control leg, so every capped leg reads unproven
  assert.deepEqual(data.legs.map((l) => l.limitProof), ['no_limit', 'unproven', 'unproven', 'unproven']);
  assert.ok(data.legs.every((l) => l.limitReadBack === null && l.probeRefused === null && l.peakAfterProbeBytes === null && l.limitMessages === null));
  assert.deepEqual(data.controlLegs, []);
  assert.equal(data.lowestChromeCommitPeakBytes, 3942731776);
  const html = renderEmulated(data);
  assert.ok(html.includes('| 8 GiB | limit unproven'.replace('| 8 GiB | ', '<td>8 GiB</td><td>')));
  assert.ok(!html.includes('limit proven in force'));
  assert.ok(!html.includes('Limit evidence'));
  assert.ok(html.includes('The 5 GiB leg is not a result under a 5 GiB cap.'));
  assert.ok(html.includes('No leg in this file failed for want of memory'));
  assert.equal([...html.matchAll(/<tr class="emulated-leg"/g)].length, 4);
});

test('checkEmulated accepts the sample and refuses a wrong spec, an empty leg list, a leg with the 8 GB cell changed and a laptop word in a label', () => {
  const sample = JSON.parse(readFileSync(join(FIX, 'e2e-emulated.sample.json'), 'utf8'));
  assert.doesNotThrow(() => checkEmulated(sample));
  assert.throws(() => checkEmulated({ ...sample, spec: 'other' }), /spec/);
  assert.throws(() => checkEmulated({ ...sample, legs: [] }), /legs/);
  const l8 = structuredClone(sample);
  l8.legs[0].laptop8gb = '8 GB laptop: 5,000 MiB';
  assert.throws(() => checkEmulated(l8), /laptop_8gb|8 GB/);
  const lw = structuredClone(sample);
  lw.legs[1].environment = 'emulated: my laptop; not a laptop';
  assert.throws(() => checkEmulated(lw), /environment label/);
});

test('checkEmulated also refuses a source that is not what the importer writes (a hash that is not hex, a file that is not the emulated CSV, a commit with markup)', () => {
  const sample = JSON.parse(readFileSync(join(FIX, 'e2e-emulated.sample.json'), 'utf8'));
  for (const [path, value] of [['csvSha256', 'zz'], ['csv', '../../e2e.csv'], ['commit', '<b>x</b>'], ['csvSha256', undefined]]) {
    const bad = structuredClone(sample);
    bad.source[path] = value;
    assert.throws(() => checkEmulated(bad), /source/, `${path}=${value}`);
  }
  const none = structuredClone(sample);
  delete none.source;
  assert.throws(() => checkEmulated(none), /source/);
});

test('benchmarks.json (the laptop columns) and the laptop CSV fixtures are not touched by the emulated data: no laptop cell reads an emulated figure', () => {
  const b = JSON.parse(readFileSync(join(root, 'data', 'benchmarks.json'), 'utf8'));
  assert.doesNotMatch(JSON.stringify(b), /emulated/i);
  const e2e = JSON.parse(readFileSync(join(root, 'data', 'e2e.json'), 'utf8'));
  assert.doesNotMatch(JSON.stringify(e2e), /emulated/i);
  for (const g of e2e.groups) assert.equal(g.laptop8gb, NOT_MEASURED_8GB);
});

test('BUG-T1-S7-05: 8 GiB, 8192 MB, 8.0 GB, 8-GB and notebook labels are refused; the WMI-built label is accepted; the pattern equals dockit\'s', () => {
  for (const bad of ['8 GiB RAM', '8192 MB RAM', '8.0 GB RAM', '8-GB RAM', 'notebook VM']) assert.throws(() => validateEnvironmentLabel(`emulated: VM with ${bad}; not a laptop`), /environment label/, bad);
  const wmi = 'emulated: GitHub-hosted Windows Server 2025 Datacenter VM, x64, 4 vCPU, 16 GB RAM, pwsh, node and Chrome process tree under a job commit limit of 8589934592 bytes; not a laptop';
  assert.equal(validateEnvironmentLabel(wmi), wmi);
  assert.equal(MACHINE_8GB_OR_LAPTOP_RE.source, SHARED_SOURCE);
});

// BUG-T1-S7-09: the widened pattern; dockit's bench-label.test.ts pins the same string
const SHARED_SOURCE = String.raw`(^|[^0-9.,])(8([.,][0-9]+)?[ .-]{0,2}(GiB|GBytes?|GBs?|gigabytes?|gibibytes?|gig|G)\b|(8000|8192)([.,]0+)? ?(MiB|MB|M)\b)|\beight[ -]?(GB|GiB|gigabytes?|gibibytes?)\b|notebook|laptop`;

test('BUG-T1-S7-09: every spelling of an 8 GB machine is refused; real labels still pass', () => {
  for (const bad of ['8.00 GB', '8,0 GB', '8 GBs', '8 GByte', '8 GBytes', '8 gig', '8 gigabytes', '8 gigabyte', '8 gibibytes', '8. GB', '8000 MB', '8000 MiB', '8192 MiB', '8192 M', 'eight GB', 'eight gigabytes', '8 GIGABYTES', 'notebook', 'laptop-like'])
    assert.throws(() => validateEnvironmentLabel(`emulated: VM with ${bad} RAM; not a laptop`), /environment label/, bad);
  for (const ok of ['16 GB RAM', '48 GB', '128 GB', '18 GB', '4 vCPU', 'with no job limit', 'under a job commit limit of 8589934592 bytes', 'under a job commit limit of 6442450944 bytes', 'under a job commit limit of 5368709120 bytes'])
    assert.equal(validateEnvironmentLabel(`emulated: VM, ${ok}; not a laptop`), `emulated: VM, ${ok}; not a laptop`, ok);
});

// ---- the limit evidence (after dockit's bench-windows run 44656249868): the read-back, the probe, "limit proven in force" and the control leg ----

const PROVEN = 'limit proven in force (probe refused, read-back equal)';
const legRows = (text) => text.trim().split('\n').slice(1);
const withoutColumns = (text, cols) => {
  const head = text.trim().split('\n')[0].split(',');
  const keep = head.map((c, i) => (cols.includes(c) ? -1 : i)).filter((i) => i >= 0);
  const pick = (line) => {
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, ''));
    return keep.map((i) => cells[i]).join(',');
  };
  return `${text.trim().split('\n').map(pick).join('\n')}\n`;
};
const sectionOfHtml = (html) => /<h2 id="emulated-windows">[\s\S]*?(?=<h2 id="memory-hardening">|<h2 id="vector-search">|<h2>Reference machine<\/h2>|$)/.exec(html)?.[0] ?? '';

test('importer: the control leg is not a leg: it is in controlLegs, with its own outcome, and the legs and the lowest Chrome-only peak are computed without it', () => {
  const d = buildEmulated(SAMPLE.e2e, SAMPLE.q);
  assert.equal(d.legs.length, 4);
  assert.equal(d.controlLegs.length, 1);
  const c = d.controlLegs[0];
  assert.equal(c.environment, label(2, true));
  assert.match(c.environment, /\(control leg, expected to fail\); not a laptop$/);
  assert.deepEqual({ limitBytes: c.limitBytes, rows: c.rows, completedRuns: c.completedRuns, failure: c.failure, outcome: c.outcome, limitProof: c.limitProof, probeRefused: c.probeRefused, limitMessages: c.limitMessages }, { limitBytes: 2 * GIB, rows: 1, completedRuns: 0, failure: 'out_of_memory', outcome: 'failed_as_expected', limitProof: 'proven', probeRefused: true, limitMessages: 3 });
  assert.equal(c.laptop8gb, NOT_MEASURED_8GB);
  // the legs are what they are without the control rows: the same JSON for the CSV with the control rows cut out
  const lines = SAMPLE.e2e.trim().split('\n');
  const noControl = `${[lines[0], ...lines.slice(1).filter((l) => !l.includes('(control leg, expected to fail)'))].join('\n')}\n`;
  const d2 = buildEmulated(noControl, SAMPLE.q);
  assert.deepEqual(d.legs, d2.legs);
  assert.deepEqual(d2.controlLegs, []);
  assert.equal(d.lowestChromeCommitPeakBytes, d2.lowestChromeCommitPeakBytes);
  // from the rows: the lowest Chrome-only commit peak of any run of a benchmark leg (the 6 GiB leg's first run: 4500 MiB + 1 MiB)
  assert.equal(d.lowestChromeCommitPeakBytes, 4500 * MIB + 1 * MIB);
});

test('importer: every leg carries its evidence: the read-back, the probe, the peak after it and the port count, and the reading follows from them', () => {
  const d = buildEmulated(SAMPLE.e2e, SAMPLE.q);
  assert.deepEqual(d.legs.map((l) => l.limitProof), ['no_limit', 'proven', 'proven', 'proven']);
  assert.deepEqual(d.legs[0].limitReadBack, { flags: '0x2000', bytes: 0 });
  assert.equal(d.legs[0].probeRefused, null);
  assert.deepEqual(d.legs[1].limitReadBack, { flags: '0x2200', bytes: 8 * GIB });
  assert.equal(d.legs[1].probeRefused, true);
  assert.equal(d.legs[1].peakAfterProbeBytes, 300 * MIB);
  assert.equal(d.legs[1].limitMessages, 1);
  assert.equal(d.legs[0].limitMessages, 0);
  for (const l of [...d.legs, ...d.controlLegs]) assert.equal(l.limitProof, limitProof(proofRow(l)));
});

test('importer: a CSV with the first header (no evidence columns) still imports, every capped leg unproven and no control leg', () => {
  const legacy = withoutColumns(SAMPLE.e2e, EVIDENCE_COLUMNS);
  // the control rows are the only rows of their environment: with no control_leg column they would be a leg of their own, so the first-run shape has none
  const lines = legacy.trim().split('\n');
  const noControl = `${[lines[0], ...lines.slice(1).filter((l) => !l.includes('(control leg, expected to fail)'))].join('\n')}\n`;
  const d = buildEmulated(noControl);
  assert.deepEqual(d.legs.map((l) => l.limitProof), ['no_limit', 'unproven', 'unproven', 'unproven']);
  assert.ok(d.legs.every((l) => l.limitReadBack === null && l.probeRefused === null && l.limitMessages === null));
  assert.deepEqual(d.controlLegs, []);
  assert.doesNotThrow(() => checkEmulated(d));
});

test('importer: the proof is "proven" only when the read-back is equal AND the probe was refused; the table is the one dockit pins', () => {
  const base = { job_commit_limit_bytes: String(5 * GIB), job_limit_readback_bytes: String(5 * GIB), job_limit_flags_readback: '0x2200', limit_probe_refused: 'true' };
  const table = [
    [base, 'proven'],
    [{ ...base, limit_probe_refused: 'false' }, 'not_enforced'],
    [{ ...base, limit_probe_refused: '' }, 'unproven'],
    [{ ...base, job_limit_readback_bytes: String(5 * GIB - 4096) }, 'readback_mismatch'],
    [{ ...base, job_limit_flags_readback: '0x2000' }, 'readback_mismatch'],
    [{ ...base, job_limit_readback_bytes: '', job_limit_flags_readback: '' }, 'unproven'],
    [{ job_commit_limit_bytes: String(5 * GIB) }, 'unproven'],
    [{ job_commit_limit_bytes: '' }, 'no_limit'],
    [{ job_commit_limit_bytes: '', job_limit_readback_bytes: '0', job_limit_flags_readback: '0x2000' }, 'no_limit'],
    [{ job_commit_limit_bytes: '', job_limit_readback_bytes: '1', job_limit_flags_readback: '0x2000' }, 'readback_mismatch'],
  ];
  for (const [row, want] of table) assert.equal(limitProof(row), want, JSON.stringify(row));
  assert.equal(LIMIT_PROOF_TEXT.proven, PROVEN);
  assert.equal(LIMIT_PROOF_TEXT.unproven, 'limit unproven');
});

test('importer refuses evidence that is partial, mistyped or contradictory: some but not all of the six columns, a probe that is not true or false, flags that are not 0x2000 or 0x2200, a count that is not an integer, rows that disagree on control_leg', () => {
  const dropOne = withoutColumns(SAMPLE.e2e, ['control_leg']);
  assert.throws(() => buildEmulated(dropOne), /column control_leg is missing/);
  assert.throws(() => buildEmulated(mutate('limit_probe_refused', 'maybe')), /limit_probe_refused must be empty, true or false/);
  assert.throws(() => buildEmulated(mutate('control_leg', 'yes')), /control_leg must be empty, true or false/);
  assert.throws(() => buildEmulated(mutate('job_limit_flags_readback', '0x2204')), /job_limit_flags_readback/);
  for (const col of ['job_limit_readback_bytes', 'job_peak_after_probe_bytes', 'job_memory_limit_messages']) for (const bad of ['-1', '1.5', '1e9', '=1+1']) assert.throws(() => buildEmulated(mutate(col, bad)), /not a non-negative integer/, `${col} = ${bad}`);
  // the first row of the sample is the none leg: one of its rows saying it is a control makes its environment disagree with itself
  assert.throws(() => buildEmulated(mutate('control_leg', 'true', 0)), /disagree on control_leg/);
});

test('with the sample fixture: every capped leg says limit proven in force, the evidence table shows the read-back and the refused commit, and the control leg is a paragraph that is in no row', () => {
  const data = sampleData();
  const html = renderEmulated(data);
  const rows = [...html.matchAll(/<tr class="emulated-leg"[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  assert.equal(rows.length, 4, 'the control leg is not a table row');
  assert.ok(rows[0].includes('<td>no limit set (read-back: JobMemoryLimit 0)</td>'));
  for (const r of rows.slice(1)) assert.ok(r.includes(`<td>${PROVEN}</td>`));
  assert.ok(html.includes('<th>Limit in force</th>'));
  assert.ok(!html.includes('limit unproven'));
  assert.ok(html.includes('The limit of every capped leg is proven in force'));
  const evidence = [...html.matchAll(/<tr class="emulated-evidence"[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  assert.equal(evidence.length, 5, 'four legs and the control');
  assert.ok(evidence[1].includes('<td>0x2200, 8,589,934,592 bytes (equal to what was set)</td><td>refused</td><td>no: 300 MiB is below the limit of 8,192 MiB</td><td>300 MiB</td><td>1</td>'));
  assert.ok(evidence[4].startsWith('<tr class="emulated-evidence"><td>2 GiB (control)</td>'));
  // the control: a paragraph of its own, from its own rows
  assert.ok(html.includes('<strong>Control leg, 2 GiB: not a benchmark figure.</strong>'));
  assert.ok(html.includes('its limit is below the lowest Chrome-only commit peak of any run of the other legs (4,501 MiB)'));
  assert.ok(html.includes('It failed with <code>out_of_memory</code> after 0 completed run(s), as it must: the limit is proven in force (probe refused, read-back equal), so the control passed.'));
  assert.ok(html.includes(`Label: <code>${label(2, true)}</code>`));
  assert.ok(!rows.join('').includes('2147483648'));
  assert.ok(html.includes('A further control leg'));
  assert.ok(!html.includes('the cap does nothing'));
  assert.doesNotMatch(html.replaceAll('NOT met', ''), /\bmet\b/);
});

test('the control leg is in none of the figures: the table rows are the same with and without it', () => {
  const data = sampleData();
  const without = structuredClone(data);
  without.controlLegs = [];
  const rowsOf = (d) => [...renderEmulated(d).matchAll(/<tr class="emulated-leg"[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  assert.deepEqual(rowsOf(data), rowsOf(without));
});

test('a commit above the limit that succeeded: the cap was not in force, in the cell and in a paragraph; the leg is neither proven nor a result under a cap', () => {
  const d = sampleData();
  const leg = d.legs[1];
  leg.probeRefused = false;
  leg.limitProof = 'not_enforced';
  assert.doesNotThrow(() => checkEmulated(d));
  const html = renderEmulated(d);
  const rows = [...html.matchAll(/<tr class="emulated-leg"[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  assert.ok(rows[1].includes('<td>cap NOT in force (the probe committed over the limit)</td>'));
  assert.ok(html.includes("<strong>The 8 GiB leg's cap was not in force.</strong>"));
  assert.ok(html.includes('A commit of the limit plus 256 MiB, made from inside the job before the benchmark started, succeeded'));
  assert.ok(html.includes('not a result under a 8 GiB cap'));
  assert.ok(!rows[1].includes(PROVEN));
  assert.ok(!html.includes('The limit of every capped leg is proven in force'), 'one capped leg is not proven');
  assert.ok(html.includes('succeeded: the cap was not in force'));
});

test('a proven leg whose peak is above its limit says the peak counts commits the limit refused; one whose peak is the probe own is not measured', () => {
  const d = firstRunShapeWithEvidence();
  const html = renderEmulated(d);
  assert.ok(html.includes("<strong>The 5 GiB leg's whole-tree peak is above its limit, and the limit is proven in force.</strong>"));
  assert.ok(html.includes('counts a commit that the limit refused: the peak is not memory the tree held'));
  assert.ok(!html.includes('is not a result under a '));
  const e = sampleData();
  e.legs[2].jobCommitPeakBytes = null;
  e.legs[2].peakAfterProbeBytes = 6 * GIB + 300 * MIB;
  assert.doesNotThrow(() => checkEmulated(e));
  const h2 = renderEmulated(e);
  assert.ok(h2.includes('<strong>The whole-tree peak of the 6 GiB leg is not measured.</strong>'));
  assert.ok(h2.includes('read 6,444 MiB right after the commit probe'));
  assert.ok(h2.includes('yes: 6,444 MiB is above the limit of 6,144 MiB'));
});
function firstRunShapeWithEvidence() {
  const d = sampleData();
  d.legs[3].failure = null;
  d.legs[3].result = 'pass';
  d.legs[3].runs = 6;
  d.legs[3].sessionRuns = 5;
  d.legs[3].restartRuns = 1;
  d.legs[3].jobCommitPeakBytes = 5793 * MIB;
  return d;
}

test('the control leg outcomes: completed is red text, failed with an unproven limit shows nothing about the cap, an incomplete one says so; checkEmulated refuses an outcome the rest does not support', () => {
  const completed = sampleData();
  Object.assign(completed.controlLegs[0], { failure: null, completedRuns: 6, rows: 6, outcome: 'completed', probeRefused: false, limitProof: 'not_enforced' });
  assert.doesNotThrow(() => checkEmulated(completed));
  assert.ok(renderEmulated(completed).includes('<strong>It completed under the control limit (6 runs): the cap does nothing, so no capped leg of this file means anything.</strong>'));

  const unproven = sampleData();
  Object.assign(unproven.controlLegs[0], { probeRefused: null, limitProof: 'unproven', outcome: 'failed_unproven' });
  assert.doesNotThrow(() => checkEmulated(unproven));
  const h = renderEmulated(unproven);
  assert.ok(h.includes('but the limit is not proven in force (limit unproven), so the stop shows nothing about the cap.'));
  assert.ok(!h.includes('so the control passed'));

  const incomplete = sampleData();
  Object.assign(incomplete.controlLegs[0], { failure: null, completedRuns: 2, rows: 2, outcome: 'incomplete' });
  assert.doesNotThrow(() => checkEmulated(incomplete));
  assert.ok(renderEmulated(incomplete).includes('It did not complete (2 row(s), 2 finished run(s), no failure reason recorded'));

  // an outcome that does not follow from the failure, the runs and the evidence
  for (const patch of [{ outcome: 'completed' }, { outcome: 'failed_unproven' }, { failure: null, outcome: 'failed_as_expected' }]) {
    const bad = sampleData();
    Object.assign(bad.controlLegs[0], patch);
    assert.throws(() => checkEmulated(bad), /outcome/);
  }
  const wrongType = sampleData();
  wrongType.controlLegs = {};
  assert.throws(() => checkEmulated(wrongType), /controlLegs must be a list/);
});

test('checkEmulated refuses a reading that does not follow from the evidence, so the page cannot say "proven" without it', () => {
  const doctored = sampleData();
  doctored.legs[1].probeRefused = null;
  assert.throws(() => checkEmulated(doctored), /limitProof proven does not follow from the evidence \(unproven\)/);
  const noReadBack = sampleData();
  noReadBack.legs[1].limitReadBack = null;
  assert.throws(() => checkEmulated(noReadBack), /does not follow from the evidence/);
  const wrongFlags = sampleData();
  wrongFlags.legs[1].limitReadBack = { flags: '0x2204', bytes: 8 * GIB };
  assert.throws(() => checkEmulated(wrongFlags), /limitReadBack/);
  const wrongProbe = sampleData();
  wrongProbe.legs[1].probeRefused = 'true';
  assert.throws(() => checkEmulated(wrongProbe), /probeRefused/);
  const wrongCount = sampleData();
  wrongCount.legs[1].limitMessages = -1;
  assert.throws(() => checkEmulated(wrongCount), /limitMessages/);
  const unknown = sampleData();
  unknown.legs[1].limitProof = 'works_under_cap';
  assert.throws(() => checkEmulated(unknown), /limitProof is not one of/);
  const peak = sampleData();
  peak.lowestChromeCommitPeakBytes = 1.5;
  assert.throws(() => checkEmulated(peak), /lowestChromeCommitPeakBytes/);
});

test('the sample page never says a leg met, passed under, survived or worked under a cap, with or without the control leg', () => {
  for (const data of [sampleData(), firstRunShapeWithEvidence(), firstRunShape(5793)]) {
    const html = renderEmulated(data);
    assert.doesNotMatch(html.replaceAll('NOT met', ''), /\bmet\b/);
    assert.doesNotMatch(html, /works? under|survives?|passes? under|within the cap/i);
    assert.doesNotMatch(html.replaceAll('not a laptop', '').replaceAll(/<td>emulated: [^<]*<\/td>/g, '').replaceAll(/<code>emulated: [^<]*<\/code>/g, ''), /laptop result|8 GB result/i);
  }
});

test('the built benchmarks page with the sample fixture holds the evidence table and the control paragraph, and nothing outside the emulated section changed', () => {
  const sample = readFileSync(join(FIX, 'e2e-emulated.sample.json'), 'utf8');
  const withData = buildCopy(sample).html;
  const without = buildCopy(undefined).html;
  const section = sectionOfHtml(withData);
  assert.ok(section.includes('class="benchmarks emulated-evidence"'));
  assert.ok(section.includes('<strong>Control leg, 2 GiB: not a benchmark figure.</strong>'));
  assert.equal(withData.replace(section, ''), without);
  assert.equal(legRows(SAMPLE.e2e).length, 6 + 6 + 6 + 2 + 1);
});
