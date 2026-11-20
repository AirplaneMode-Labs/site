import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build, checkEmulated, renderEmulated } from '../scripts/build.mjs';
import { buildEmulated, importEmulated, serialise, validateEnvironmentLabel, MACHINE_8GB_OR_LAPTOP_RE, ENVIRONMENT_RE, EMULATED_SPEC, NOT_MEASURED_8GB } from '../scripts/import-dockit-emulated.mjs';

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
