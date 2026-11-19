#!/usr/bin/env node
// Reads dockit's two end-to-end benchmark CSVs (written by `npm run bench:e2e` in dockit, never typed by hand) and writes data/e2e.json:
// medians and worst values per (machine, restart), the per-question results, and the result of the fixed question set as
// 'N of M correct with the correct source page' for the first run and over ALL runs (no run is selected). It records the source
// commit and the sha256 of both CSVs. The benchmarks page is built from that file only.
//
// Two page columns, as dockit writes them (TD-59, BUG-T1-S5-R2-05): correct_source_page is true only when a CITED source shown to the user
// names the expected page (a refused answer cites nothing, so it is false), and top_retrieved_page_ok says whether the top-ranked retrieved
// passage is on the expected page (retrieval quality). The joint headline keeps its definition: answer_ok and correct_source_page.
//
// Sprint 6 (B1, TD-77): the same importer reads the baseline pair that dockit took before the memory measures (e2e-s6-baseline.csv and
// e2e-questions-s6-baseline.csv) and writes it under `baseline`, next to the after set at the top level, with the target that TD-66 stated
// before anything was measured. The page computes whether the target was reached from these two sets; no outcome is typed.
//
// Usage: node scripts/import-dockit-bench.mjs --from <e2e.csv> --questions <e2e-questions.csv> [--baseline-from <csv> --baseline-questions <csv>] [--out <data/e2e.json>] [--check]
//   --check  recompute and exit 1 when the output file differs (writes nothing)
//
// "Worst" is the largest value of a time or a memory figure. Peak memory is process_rss_peak_bytes: the peak summed resident size of the
// test Chrome's process tree. js_heap_peak_bytes and wasm_memory_peak_bytes are separate figures under their own names. Nothing was
// measured on an 8 GB laptop, and the data says so: both CSVs carry a laptop_8gb column that must read 'not measured on 8 GB' on every row
// (dockit's bench-e2e writes it; this importer refuses a file where it is missing or reads anything else), and it is passed through to the data.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './import-localdata-bench.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const SITE_ROOT = join(here, '..');
export const E2E_JSON = join(SITE_ROOT, 'data', 'e2e.json');
export const COMMAND = 'npm run bench:e2e';
export const SPEC = 'airplanemode.site.e2e/1';
export const NOT_MEASURED_8GB = 'not measured on 8 GB';

/**
 * What TD-66 (19 Nov 2026, architect) stated BEFORE the after-measurement: the Chrome process-tree peak median at most 5,120 MiB on the Apple M5 Pro
 * (the baseline is 6,283 MiB median in the Sprint 5 CSV), the fixed question set no worse than 24 of 36 over all runs and 4 of 6 on the first run, and a
 * median per-question total answer time of at most 12,500 ms. A constant of this file with its source, not a figure of any CSV.
 */
export const MEMORY_TARGET = Object.freeze({ decision: 'TD-66', rssMedianMiB: 5120, totalMedianMs: 12500, questionFirstRunMin: 4, questionAllMin: 24 });

const E2E_REQUIRED = ['date', 'machine', 'chrome', 'commit', 'run', 'restart', 'pdf', 'pages', 'chunks', 'held', 'first_token_ms', 'total_ms', 'js_heap_peak_bytes', 'wasm_memory_peak_bytes', 'process_rss_peak_bytes', 'storage_usage_bytes', 'requests_after_offline', 'model', 'backend', 'answer_ok', 'laptop_8gb'];
const Q_REQUIRED = ['date', 'machine', 'commit', 'run', 'restart', 'qid', 'answer_ok', 'correct_source_page', 'top_retrieved_page_ok', 'first_token_ms', 'total_ms', 'laptop_8gb'];
const NUMERIC = ['first_token_ms', 'total_ms', 'js_heap_peak_bytes', 'wasm_memory_peak_bytes', 'process_rss_peak_bytes', 'storage_usage_bytes'];

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const num = (s) => (s === '' || s === undefined ? null : Number(s));

function need(records, required, what) {
  if (records.length === 0) throw new Error(`${what}: no rows`);
  for (const c of required) if (!(c in records[0])) throw new Error(`${what}: column ${c} is missing`);
  // BUG-T1-S5-07: every row of both dockit CSVs says that nothing was measured on an 8 GB laptop; a row that says anything else is not shown
  records.forEach((r, i) => {
    if (r.laptop_8gb !== NOT_MEASURED_8GB) throw new Error(`${what}: row ${i + 1}: laptop_8gb must read '${NOT_MEASURED_8GB}', not '${r.laptop_8gb}'`);
  });
}

/** Median of numbers (an even count averages the two middle ones), rounded to an integer; null when there is no number. */
export function median(values) {
  const v = values.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = v.length >> 1;
  return Math.round(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2);
}
const worst = (values) => {
  const v = values.filter((x) => x !== null && Number.isFinite(x));
  return v.length === 0 ? null : Math.max(...v);
};
const stat = (rows, col) => {
  const vals = rows.map((r) => num(r[col]));
  // a figure is reported only when every run of the group has it: a median over some runs would read as a measurement of all of them
  if (vals.some((v) => v === null)) return null;
  return { median: median(vals), worst: worst(vals) };
};

/** The JSON the benchmarks page is built from. Throws on a row that does not look like a benchmark row. */
export function buildE2e(e2eText, questionsText, { csvName = 'docs/benchmarks/e2e.csv', questionsName = 'docs/benchmarks/e2e-questions.csv' } = {}) {
  const e2e = parseCsv(e2eText);
  const qs = parseCsv(questionsText);
  need(e2e, E2E_REQUIRED, csvName);
  need(qs, Q_REQUIRED, questionsName);
  for (const r of e2e) {
    for (const c of NUMERIC) if (r[c] !== '' && !Number.isFinite(Number(r[c]))) throw new Error(`${csvName}: run ${r.run}: ${c} is not a number: ${r[c]}`);
    if (r.requests_after_offline === '' || !Number.isInteger(Number(r.requests_after_offline))) throw new Error(`${csvName}: run ${r.run}: requests_after_offline is missing`);
  }
  const groups = [];
  const keyOf = (r) => `${r.machine}\u0000${r.restart}`;
  for (const key of [...new Set(e2e.map(keyOf))]) {
    const rows = e2e.filter((r) => keyOf(r) === key);
    const first = rows[0];
    groups.push({
      machine: first.machine,
      restart: first.restart === 'true',
      runs: rows.length,
      chrome: [...new Set(rows.map((r) => r.chrome))].join(', '),
      commit: [...new Set(rows.map((r) => r.commit))].join(', '),
      pages: num(first.pages),
      chunks: num(first.chunks),
      held: num(first.held),
      first_token_ms: stat(rows, 'first_token_ms'),
      total_ms: stat(rows, 'total_ms'),
      process_rss_peak_bytes: stat(rows, 'process_rss_peak_bytes'),
      js_heap_peak_bytes: stat(rows, 'js_heap_peak_bytes'),
      wasm_memory_peak_bytes: stat(rows, 'wasm_memory_peak_bytes'),
      storage_usage_bytes: stat(rows, 'storage_usage_bytes'),
      requests_after_offline: { max: Math.max(...rows.map((r) => Number(r.requests_after_offline))) },
      answer_ok_q1: { ok: rows.filter((r) => r.answer_ok === 'true').length, of: rows.length },
      model: [...new Set(rows.map((r) => r.model))].join('; '),
      backend: [...new Set(rows.map((r) => r.backend))].join('; '),
      laptop8gb: [...new Set(rows.map((r) => r.laptop_8gb))].join('; '),
    });
  }
  // the two page columns agree on which rows have a page at all: a value in one and a blank in the other is a broken file
  qs.forEach((r, i) => {
    for (const c of ['correct_source_page', 'top_retrieved_page_ok']) {
      if (!['true', 'false', ''].includes(r[c])) throw new Error(`${questionsName}: row ${i + 1}: ${c} must be true, false or empty, not '${r[c]}'`);
    }
    if ((r.correct_source_page === '') !== (r.top_retrieved_page_ok === '')) {
      throw new Error(`${questionsName}: row ${i + 1}: correct_source_page and top_retrieved_page_ok must both be empty (no page) or both be set`);
    }
  });
  const qids = [...new Set(qs.map((r) => r.qid))];
  const runs = [...new Set(qs.map((r) => Number(r.run)))].sort((a, b) => a - b);
  const correct = (r) => r.answer_ok === 'true' && r.correct_source_page === 'true';
  const answerable = (r) => r.correct_source_page !== '';
  const perQuestion = qids.map((qid) => {
    const rows = qs.filter((r) => r.qid === qid);
    return {
      qid,
      runs: rows.length,
      answerOk: rows.filter((r) => r.answer_ok === 'true').length,
      pageOk: rows.filter((r) => r.correct_source_page === 'true').length,
      topRetrievedOk: rows.filter((r) => r.top_retrieved_page_ok === 'true').length,
      answerable: rows.every(answerable),
      first_token_ms: stat(rows, 'first_token_ms'),
      laptop8gb: [...new Set(rows.map((r) => r.laptop_8gb))].join('; '),
    };
  });
  const firstRun = qs.filter((r) => Number(r.run) === runs[0] && answerable(r));
  const all = qs.filter(answerable);
  const unanswerable = qs.filter((r) => !answerable(r));
  const questions = {
    perQuestion,
    firstRun: { correct: firstRun.filter(correct).length, of: firstRun.length, run: runs[0] },
    all: { correct: all.filter(correct).length, of: all.length, runs: runs.length },
    // TD-59: reported next to the joint figure, never inside it. A refused answer cites nothing, so it is not in citedPage.
    citedPage: { ok: all.filter((r) => r.correct_source_page === 'true').length, of: all.length },
    topRetrieved: { ok: all.filter((r) => r.top_retrieved_page_ok === 'true').length, of: all.length },
    unanswerable: { refused: unanswerable.filter((r) => r.answer_ok === 'true').length, of: unanswerable.length },
    // the time of every question row of every run (the restart run included): what the TD-66 time guard (median total at most 12,500 ms) is read from
    timing: { rows: qs.length, first_token_ms: stat(qs, 'first_token_ms'), total_ms: stat(qs, 'total_ms') },
    selection: 'none: every run of every question is counted',
  };
  return {
    spec: SPEC,
    command: COMMAND,
    source: {
      csv: csvName,
      csvSha256: sha256(e2eText),
      questionsCsv: questionsName,
      questionsCsvSha256: sha256(questionsText),
      commit: [...new Set(e2e.map((r) => r.commit))].join(', '),
      date: e2e[0].date,
      rows: e2e.length,
    },
    groups,
    questions,
  };
}

/**
 * The after set at the top level (as before), the baseline set under `baseline` (the same shape, without a spec or command of its own) and the
 * TD-66 target under `target`. `after` and `baseline` are [e2eCsvText, questionsCsvText] pairs.
 */
export function buildE2eWithBaseline({ after, baseline, names = {}, baselineNames = {} }) {
  const a = buildE2e(after[0], after[1], names);
  const b = buildE2e(baseline[0], baseline[1], {
    csvName: 'docs/benchmarks/e2e-s6-baseline.csv',
    questionsName: 'docs/benchmarks/e2e-questions-s6-baseline.csv',
    ...baselineNames,
  });
  const { spec: _spec, command: _command, ...base } = b;
  return { ...a, baseline: base, target: { ...MEMORY_TARGET } };
}

export const serialise = (data) => `${JSON.stringify(data, null, 2)}\n`;

export function importE2e({ from, questions, baselineFrom, baselineQuestions, out = E2E_JSON, write = true, csvName, questionsName } = {}) {
  const files = [from, questions, ...(baselineFrom ? [baselineFrom, baselineQuestions] : [])];
  for (const f of files) if (!f || !existsSync(f)) throw new Error(`${f} does not exist`);
  const names = { ...(csvName ? { csvName } : {}), ...(questionsName ? { questionsName } : {}) };
  const data = baselineFrom
    ? buildE2eWithBaseline({
        after: [readFileSync(from, 'utf8'), readFileSync(questions, 'utf8')],
        baseline: [readFileSync(baselineFrom, 'utf8'), readFileSync(baselineQuestions, 'utf8')],
        names,
      })
    : buildE2e(readFileSync(from, 'utf8'), readFileSync(questions, 'utf8'), names);
  const next = serialise(data);
  const changed = !existsSync(out) || readFileSync(out, 'utf8') !== next;
  if (write && changed) writeFileSync(out, next);
  return { data, changed, out };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (n) => {
    const i = args.indexOf(n);
    return i >= 0 ? resolve(args[i + 1] ?? '') : undefined;
  };
  const from = opt('--from');
  const questions = opt('--questions');
  const baselineFrom = opt('--baseline-from');
  const baselineQuestions = opt('--baseline-questions');
  const check = args.includes('--check');
  if (!from || !questions || Boolean(baselineFrom) !== Boolean(baselineQuestions)) {
    console.error('usage: import-dockit-bench.mjs --from <e2e.csv> --questions <e2e-questions.csv> [--baseline-from <csv> --baseline-questions <csv>] [--out <file>] [--check]');
    process.exit(2);
  }
  try {
    const r = importE2e({ from, questions, baselineFrom, baselineQuestions, out: opt('--out') ?? E2E_JSON, write: !check });
    const q = r.data.questions;
    console.log(`import-dockit-bench: ${r.data.source.rows} runs; ${q.firstRun.correct} of ${q.firstRun.of} correct with the correct source page on the first run, ${q.all.correct} of ${q.all.of} over all runs`);
    if (check && r.changed) {
      console.error(`${r.out} differs from the CSVs; run without --check`);
      process.exit(1);
    }
    console.log(check ? `${r.out} is up to date` : r.changed ? `wrote ${r.out}` : `${r.out} already up to date`);
  } catch (e) {
    console.error(`import-dockit-bench: ${e.message}`);
    process.exit(1);
  }
}
