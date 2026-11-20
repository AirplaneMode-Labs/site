#!/usr/bin/env node
// Reads dockit's EMULATED Windows benchmark CSVs (docs/benchmarks/e2e-emulated-win-vm.csv and e2e-emulated-win-vm-questions.csv, written by the manual
// bench-windows workflow and never typed by hand) and writes data/e2e-emulated.json, from which the benchmarks page renders its 'Emulated on a GitHub-hosted
// Windows VM (not a laptop)' section. With no CSV it writes nothing, and the page has no such section and no such text (Sprint 7, B6, TD-113).
//
// Everything is checked on the way in, because a CSV is data from a CI run, not trusted markup:
//   - environment must be 'emulated: <what was run>; not a laptop' from a small safe alphabet, say 'laptop' only in that suffix and not read as an 8 GB machine;
//   - every figure must be an empty cell or a non-negative integer written in plain decimal (no sign, no exponent, no formula);
//   - failure_reason must be empty or one of four reasons;
//   - laptop_8gb must read exactly 'not measured on 8 GB' on every row, in both files.
// A row that fails any of these refuses the whole import. The laptop CSVs (e2e.csv, e2e-questions.csv) are never read here.
//
// Usage: node scripts/import-dockit-emulated.mjs [--from-dir <dockit/docs/benchmarks>] [--out <data/e2e-emulated.json>] [--check]
//   --check  recompute and exit 1 when the output differs (writes nothing)
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './import-localdata-bench.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const SITE_ROOT = join(here, '..');
export const EMULATED_JSON = join(SITE_ROOT, 'data', 'e2e-emulated.json');
export const EMULATED_SPEC = 'airplanemode.site.e2e-emulated/1';
export const NOT_MEASURED_8GB = 'not measured on 8 GB';
export const COMMAND = 'bench-windows workflow: node scripts/bench-e2e.mjs --environment <label> inside scripts/win/run-capped.ps1';
export const CSV_FILE = 'e2e-emulated-win-vm.csv';
export const Q_FILE = 'e2e-emulated-win-vm-questions.csv';
export const FAILURE_REASONS = ['renderer_crash', 'browser_disconnected', 'worker_crash', 'out_of_memory'];
/** Same pattern as dockit's ENVIRONMENT_LABEL_RE (scripts/lib/bench-columns.mjs); test:siblings compares the two. */
export const ENVIRONMENT_RE = /^emulated: [A-Za-z0-9 ,.;:()/+-]{1,300}; not a laptop$/;
const SUFFIX = '; not a laptop';
// BUG-T1-S7-05: the same pattern as MACHINE_8GB_OR_LAPTOP_RE in dockit/scripts/lib/bench-columns.mjs (a test pins both). A safety net for typed labels;
// the real label comes from WMI facts in dockit's run-capped.ps1, with the job limit written in bytes.
export const MACHINE_8GB_OR_LAPTOP_RE = /(^|[^0-9.,])(8([.,][0-9]+)?[ .-]{0,2}(GiB|GBytes?|GBs?|gigabytes?|gibibytes?|gig|G)\b|(8000|8192)([.,]0+)? ?(MiB|MB|M)\b)|\beight[ -]?(GB|GiB|gigabytes?|gibibytes?)\b|notebook|laptop/i;

/** Returns the label or throws an Error that starts with 'environment label'. */
export function validateEnvironmentLabel(label) {
  if (typeof label !== 'string') throw new Error('environment label must be a string');
  if (!ENVIRONMENT_RE.test(label)) throw new Error(`environment label does not read 'emulated: <what was run>; not a laptop' in the allowed alphabet: ${JSON.stringify(String(label).slice(0, 60))}`);
  const body = label.slice(0, -SUFFIX.length);
  if (/laptop/i.test(body)) throw new Error("environment label may say 'laptop' only in its '; not a laptop' suffix");
  if (MACHINE_8GB_OR_LAPTOP_RE.test(body)) throw new Error('environment label must not read as an 8 GB machine or a notebook');
  return label;
}

const E2E_REQUIRED = ['date', 'machine', 'chrome', 'commit', 'run', 'restart', 'first_token_ms', 'total_ms', 'js_heap_peak_bytes', 'wasm_memory_peak_bytes', 'process_rss_peak_bytes', 'storage_usage_bytes', 'requests_after_offline', 'answer_ok', 'laptop_8gb', 'environment', 'job_commit_limit_bytes', 'job_commit_peak_bytes', 'process_commit_peak_bytes', 'job_escapes', 'sampler_median_interval_ms', 'failure_reason'];
const E2E_INTEGERS = ['first_token_ms', 'total_ms', 'js_heap_peak_bytes', 'wasm_memory_peak_bytes', 'process_rss_peak_bytes', 'storage_usage_bytes', 'requests_after_offline', 'job_commit_limit_bytes', 'job_commit_peak_bytes', 'process_commit_peak_bytes', 'job_escapes', 'sampler_median_interval_ms'];
const Q_REQUIRED = ['date', 'machine', 'commit', 'run', 'restart', 'qid', 'answer_ok', 'correct_source_page', 'top_retrieved_page_ok', 'first_token_ms', 'total_ms', 'laptop_8gb', 'environment', 'failure_reason'];
const Q_INTEGERS = ['first_token_ms', 'total_ms'];

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const INTEGER = /^\d{1,16}$/;
const num = (s) => (s === '' || s === undefined ? null : Number(s));

function check(records, required, integers, what) {
  if (records.length === 0) throw new Error(`${what}: no rows`);
  for (const c of required) if (!(c in records[0])) throw new Error(`${what}: column ${c} is missing`);
  records.forEach((r, i) => {
    if (r.laptop_8gb !== NOT_MEASURED_8GB) throw new Error(`${what}: row ${i + 1}: laptop_8gb must read '${NOT_MEASURED_8GB}', not '${String(r.laptop_8gb).slice(0, 40)}'`);
    try {
      validateEnvironmentLabel(r.environment);
    } catch (e) {
      throw new Error(`${what}: row ${i + 1}: ${e.message}`);
    }
    // bench-e2e writes the label as the machine of an emulated row too; a row where the two differ was not written by it
    if (r.machine !== r.environment) throw new Error(`${what}: row ${i + 1}: machine must equal environment in an emulated file`);
    if (r.failure_reason !== '' && !FAILURE_REASONS.includes(r.failure_reason)) throw new Error(`${what}: row ${i + 1}: failure_reason must be empty or one of ${FAILURE_REASONS.join(', ')}`);
    if (!['true', 'false'].includes(r.restart)) throw new Error(`${what}: row ${i + 1}: restart must be true or false`);
    for (const c of integers) if (r[c] !== '' && !INTEGER.test(r[c])) throw new Error(`${what}: row ${i + 1}: ${c} is not a non-negative integer: ${JSON.stringify(r[c].slice(0, 30))}`);
  });
}

/** Median of integers (an even count averages the two middle ones, rounded to an integer); null when there is no number. */
export function median(values) {
  const v = values.filter((x) => x !== null).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = v.length >> 1;
  return Math.round(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2);
}
/** { median, worst } over every row, or null when any row lacks the figure: a median over some rows would read as all of them. */
const stat = (rows, col) => {
  const v = rows.map((r) => num(r[col]));
  return v.length === 0 || v.some((x) => x === null) ? null : { median: median(v), worst: Math.max(...v) };
};
const maxOf = (rows, col) => {
  const v = rows.map((r) => num(r[col])).filter((x) => x !== null);
  return v.length === 0 ? null : Math.max(...v);
};

/** The JSON the benchmarks page is built from, for the runs CSV text and (optionally) the questions CSV text. */
export function buildEmulated(e2eText, questionsText, { csvName = `docs/benchmarks/${CSV_FILE}`, questionsName = `docs/benchmarks/${Q_FILE}` } = {}) {
  const e2e = parseCsv(e2eText);
  check(e2e, E2E_REQUIRED, E2E_INTEGERS, csvName);
  const qs = questionsText === undefined ? undefined : parseCsv(questionsText);
  if (qs !== undefined) check(qs, Q_REQUIRED, Q_INTEGERS, questionsName);
  const legs = [...new Set(e2e.map((r) => r.environment))].map((environment) => {
    const rows = e2e.filter((r) => r.environment === environment);
    const session = rows.filter((r) => r.restart === 'false');
    const limits = [...new Set(rows.map((r) => r.job_commit_limit_bytes))];
    if (limits.length !== 1) throw new Error(`${csvName}: the rows of one environment disagree on job_commit_limit_bytes`);
    const failure = rows.map((r) => r.failure_reason).find((x) => x !== '') ?? null;
    const requests = Math.max(...rows.map((r) => Number(r.requests_after_offline || 0)));
    const result = failure !== null ? 'fail' : session.length >= 5 && rows.length > session.length && requests === 0 ? 'pass' : 'incomplete';
    let questions = null;
    if (qs !== undefined) {
      const q = qs.filter((r) => r.environment === environment);
      const answerable = q.filter((r) => r.correct_source_page !== '');
      const correct = (r) => r.answer_ok === 'true' && r.correct_source_page === 'true';
      const first = Number(q[0]?.run ?? 0);
      questions = { all: { correct: answerable.filter(correct).length, of: answerable.length }, firstRun: { correct: answerable.filter((r) => Number(r.run) === first && correct(r)).length, of: answerable.filter((r) => Number(r.run) === first).length } };
    }
    return {
      environment,
      limitBytes: limits[0] === '' ? null : Number(limits[0]),
      runs: rows.length,
      sessionRuns: session.length,
      restartRuns: rows.length - session.length,
      chrome: [...new Set(rows.map((r) => r.chrome).filter(Boolean))].join(', '),
      commit: [...new Set(rows.map((r) => r.commit))].join(', '),
      first_token_ms: stat(rows, 'first_token_ms'),
      total_ms: stat(rows, 'total_ms'),
      process_rss_peak_bytes: stat(rows, 'process_rss_peak_bytes'),
      processCommitPeakBytes: stat(rows, 'process_commit_peak_bytes'),
      jobCommitPeakBytes: maxOf(rows, 'job_commit_peak_bytes'),
      jobEscapes: maxOf(rows, 'job_escapes'),
      samplerMedianIntervalMs: stat(rows, 'sampler_median_interval_ms'),
      requestsAfterOffline: { max: requests },
      failure,
      result,
      questions,
      laptop8gb: NOT_MEASURED_8GB,
    };
  });
  return {
    spec: EMULATED_SPEC,
    command: COMMAND,
    source: {
      csv: csvName,
      csvSha256: sha256(e2eText),
      questionsCsv: qs === undefined ? null : questionsName,
      questionsCsvSha256: qs === undefined ? null : sha256(questionsText),
      commit: [...new Set(e2e.map((r) => r.commit))].join(', '),
      date: e2e[0].date,
      rows: e2e.length,
    },
    legs,
  };
}

export const serialise = (data) => `${JSON.stringify(data, null, 2)}\n`;

/**
 * Imports from <dir>/e2e-emulated-win-vm.csv (and the questions file beside it). No runs CSV: nothing is written ({ written: false }). A questions CSV with no
 * runs CSV is refused. `write` false only computes.
 */
export function importEmulated({ dir, out = EMULATED_JSON, write = true } = {}) {
  const csv = join(dir, CSV_FILE);
  const q = join(dir, Q_FILE);
  if (!existsSync(csv)) {
    if (existsSync(q)) throw new Error(`${Q_FILE} is there but ${CSV_FILE} is not`);
    return { written: false, changed: false, reason: 'no emulated CSV', out };
  }
  const data = buildEmulated(readFileSync(csv, 'utf8'), existsSync(q) ? readFileSync(q, 'utf8') : undefined);
  const next = serialise(data);
  const changed = !existsSync(out) || readFileSync(out, 'utf8') !== next;
  if (write && changed) writeFileSync(out, next);
  return { written: write, changed, data, out };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (n) => {
    const i = args.indexOf(n);
    return i >= 0 ? resolve(args[i + 1] ?? '') : undefined;
  };
  const dir = opt('--from-dir') ?? join(SITE_ROOT, '..', 'dockit', 'docs', 'benchmarks');
  const check = args.includes('--check');
  try {
    const r = importEmulated({ dir, out: opt('--out') ?? EMULATED_JSON, write: !check });
    if (r.reason) console.log(`import-dockit-emulated: ${r.reason}: nothing written`);
    else if (check && r.changed) {
      console.error(`${r.out} differs from the CSV; run without --check`);
      process.exit(1);
    } else console.log(check ? `${r.out} is up to date` : r.changed ? `wrote ${r.out}` : `${r.out} already up to date`);
  } catch (e) {
    console.error(`import-dockit-emulated: ${e.message}`);
    process.exit(1);
  }
}
