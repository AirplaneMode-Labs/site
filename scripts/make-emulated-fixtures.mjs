// Writes the synthetic fixtures of the emulated benchmark section: test/fixtures/e2e-emulated.sample.csv, e2e-emulated-questions.sample.csv,
// e2e-emulated.sample.json (the importer's output for those two CSVs) and e2e-emulated.hostile.json (the same data with hostile cells).
// Every figure is INVENTED to exercise the importer and the page; nothing was measured, and the label says so. The test imports SAMPLE from here, so the
// committed files cannot drift from it.   node scripts/make-emulated-fixtures.mjs [--check]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEmulated, NOT_MEASURED_8GB, serialise } from './import-dockit-emulated.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, '..', 'test', 'fixtures');

// The header of dockit's emulated CSV (E2E_EMULATED_COLUMNS in dockit/scripts/lib/bench-columns.mjs, compared with the live file by test:siblings).
export const COLUMNS = ['date', 'machine', 'chrome', 'commit', 'run', 'restart', 'pdf', 'pages', 'chunks', 'held', 'triage_ms', 'extract_ms', 'gate_ms', 'embed_ms', 'index_ms', 'retrieve_ms', 'first_token_ms', 'total_ms', 'out_tokens', 'tokens_per_s', 'js_heap_peak_bytes', 'wasm_memory_peak_bytes', 'process_rss_peak_bytes', 'storage_usage_bytes', 'requests_after_offline', 'model', 'backend', 'answer_ok', 'laptop_8gb', 'host_load_1m_start', 'host_load_1m_end', 'environment', 'job_commit_limit_bytes', 'job_commit_peak_bytes', 'process_commit_peak_bytes', 'job_escapes', 'sampler_median_interval_ms', 'failure_reason', 'job_limit_readback_bytes', 'job_limit_flags_readback', 'limit_probe_refused', 'job_peak_after_probe_bytes', 'job_memory_limit_messages', 'control_leg'];
export const Q_COLUMNS = ['date', 'machine', 'commit', 'run', 'restart', 'qid', 'answer_ok', 'correct_source_page', 'top_retrieved_page_ok', 'first_token_ms', 'total_ms', 'laptop_8gb', 'environment', 'failure_reason'];
export const GIB = 1073741824;
export const MIB = 1048576;
export const label = (limit, control = false) =>
  `emulated: synthetic fixture on a GitHub-hosted Windows Server VM, x64, 4 vCPU, pwsh, node and Chrome process tree ${limit === null ? 'with no job limit' : `under a job commit limit of ${limit * 1073741824} bytes${control ? ' (control leg, expected to fail)' : ''}`}; not a laptop`;
export const cell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const csv = (cols, rows) => `${cols.join(',')}\n${rows.map((r) => cols.map((c) => cell(r[c])).join(',')).join('\n')}\n`;

/** Invented rows for four legs (none, 8, 6 and 5 GiB; the 5 GiB leg fails at its second run) and the 2 GiB control leg, which fails at once with its limit proven in force. */
function sampleRows() {
  const e2e = [];
  const qs = [];
  const legs = [
    { limit: null, peak: 5000, chrome: 4700, fail: '' },
    { limit: 8, peak: 4900, chrome: 4600, fail: '' },
    { limit: 6, peak: 4800, chrome: 4500, fail: '' },
    { limit: 5, peak: 5100, chrome: 4800, fail: 'out_of_memory' },
  ];
  for (const [i, l] of legs.entries()) {
    const n = l.fail ? 2 : 6;
    for (let run = 1; run <= n; run++) {
      const failed = l.fail && run === 2;
      const row = Object.fromEntries(COLUMNS.map((c) => [c, '']));
      Object.assign(row, {
        date: `2026-11-21T0${i}:00:00.000Z`, machine: label(l.limit), chrome: 'Chrome/157.0.8103.79', commit: 'aaaaaaaaaaaa', run, restart: run === 6, pdf: 'policy-3p.pdf',
        pages: 3, chunks: 3, held: 0, first_token_ms: failed ? '' : 9000 + run * 10, total_ms: failed ? '' : 14000 + run * 10,
        js_heap_peak_bytes: 50 * MIB, wasm_memory_peak_bytes: 2200 * MIB, process_rss_peak_bytes: (l.chrome - 300) * MIB, storage_usage_bytes: 800 * MIB,
        requests_after_offline: 0, model: 'Qwen3-0.6B q8 + multilingual-e5-small q8', backend: 'transformers-js wasm (single-threaded)', answer_ok: !failed,
        laptop_8gb: NOT_MEASURED_8GB, environment: label(l.limit), job_commit_limit_bytes: l.limit === null ? '' : l.limit * GIB, job_commit_peak_bytes: l.peak * MIB,
        process_commit_peak_bytes: l.chrome * MIB + run * MIB, job_escapes: 0, sampler_median_interval_ms: 700 + run, failure_reason: failed ? l.fail : '',
        // the limit evidence as the merge step writes it: the leg with no limit read back (0x2000, 0); a capped leg read back equal, with the probe refused and a port count
        ...(l.limit === null
          ? { job_limit_readback_bytes: 0, job_limit_flags_readback: '0x2000', limit_probe_refused: '', job_peak_after_probe_bytes: '', job_memory_limit_messages: 0, control_leg: false }
          : { job_limit_readback_bytes: l.limit * GIB, job_limit_flags_readback: '0x2200', limit_probe_refused: true, job_peak_after_probe_bytes: 300 * MIB, job_memory_limit_messages: 1, control_leg: false }),
      });
      e2e.push(row);
      for (const qid of ['q1', 'q2', 'q7']) {
        qs.push({ date: row.date, machine: label(l.limit), commit: 'aaaaaaaaaaaa', run, restart: run === 6, qid, answer_ok: !failed, correct_source_page: qid === 'q7' ? '' : !failed, top_retrieved_page_ok: qid === 'q7' ? '' : true, first_token_ms: failed ? '' : 9000, total_ms: failed ? '' : 14000, laptop_8gb: NOT_MEASURED_8GB, environment: label(l.limit), failure_reason: failed ? l.fail : '' });
      }
    }
  }
  // the control leg: the benchmark fails before its first run completes, so there is one run-0 row (dockit's zero-row rule) with every figure empty
  const control = Object.fromEntries(COLUMNS.map((c) => [c, '']));
  Object.assign(control, {
    date: '2026-11-21T04:00:00.000Z', machine: label(2, true), commit: 'aaaaaaaaaaaa', run: 0, restart: false, answer_ok: false, laptop_8gb: NOT_MEASURED_8GB, environment: label(2, true),
    job_commit_limit_bytes: 2 * GIB, failure_reason: 'out_of_memory', job_limit_readback_bytes: 2 * GIB, job_limit_flags_readback: '0x2200', limit_probe_refused: true, job_peak_after_probe_bytes: 300 * MIB,
    job_memory_limit_messages: 3, control_leg: true,
  });
  e2e.push(control);
  qs.push({ date: control.date, machine: label(2, true), commit: 'aaaaaaaaaaaa', run: 0, restart: false, qid: '', answer_ok: false, correct_source_page: '', top_retrieved_page_ok: '', first_token_ms: '', total_ms: '', laptop_8gb: NOT_MEASURED_8GB, environment: label(2, true), failure_reason: 'out_of_memory' });
  return { e2e: csv(COLUMNS, e2e), q: csv(Q_COLUMNS, qs) };
}
export const SAMPLE = sampleRows();

/** The importer's output for the sample, with three hostile cells: a script tag, a quote that opens an attribute and a spreadsheet formula. */
export function hostileData() {
  const d = structuredClone(buildEmulated(SAMPLE.e2e, SAMPLE.q));
  d.legs[0].environment = 'emulated: <script>alert(1)</script>; not a laptop';
  d.legs[1].failure = '"onerror=alert(1)';
  d.legs[1].result = 'fail';
  d.legs[2].commit = '=HYPERLINK("http://example.invalid/x","y")';
  return d;
}

export const FILES = {
  'e2e-emulated.sample.csv': () => SAMPLE.e2e,
  'e2e-emulated-questions.sample.csv': () => SAMPLE.q,
  'e2e-emulated.sample.json': () => serialise(buildEmulated(SAMPLE.e2e, SAMPLE.q)),
  'e2e-emulated.hostile.json': () => serialise(hostileData()),
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const [name, make] of Object.entries(FILES)) {
    const file = join(FIX, name);
    const text = make();
    if (!existsSync(file) || readFileSync(file, 'utf8') !== text) {
      stale += 1;
      if (!check) writeFileSync(file, text);
    }
  }
  if (check && stale > 0) {
    console.error(`${stale} emulated fixture(s) are stale: run node scripts/make-emulated-fixtures.mjs`);
    process.exit(1);
  }
  console.log(check ? 'emulated fixtures are up to date' : `wrote ${stale} emulated fixture(s)`);
}
