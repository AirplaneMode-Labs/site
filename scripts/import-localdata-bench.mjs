#!/usr/bin/env node
// Reads localdata/docs/benchmarks/vector-index.csv (written by `npm run bench:vectors` in localdata, never
// typed by hand) and rewrites the two localdata flat-index rows of data/benchmarks.json: 100,000 x 384 with
// 256-byte and with 2,048-byte synthetic chunks, OPFS, cold open plus the first query (k = 10), as median and
// worst of the cold runs. With no CSV the rows read "not measured". Zero dependencies.
//
// Usage: node scripts/import-localdata-bench.mjs [--csv <path>] [--check]
//   --check  print the rows and exit 1 when data/benchmarks.json differs from them (writes nothing)
//
// Expected CSV columns (header names are case-insensitive; the aliases in parentheses are accepted):
//   driver (opfs | indexeddb), rows, dim, chunk_bytes (chunk_size), restart (true for the browser-restart run,
//   false for a cold run; run is 1..6; only when there is no restart column does a run label that contains
//   "restart" mark a browser-restart run), cold_total_ms, match,
//   precise_memory, machine, commit. Other columns (index_bytes, wasm_memory_bytes, js_heap_peak_bytes,
//   storage_usage_bytes, note) are ignored here; they belong to the Sprint 4 report's memory budget table.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const SITE_ROOT = join(here, '..');
export const CSV_CITE = 'localdata/docs/benchmarks/vector-index.csv';
export const SIBLING_CSV = join(SITE_ROOT, '..', 'localdata', 'docs', 'benchmarks', 'vector-index.csv');
export const COMMAND = 'npm run bench:vectors';

const ROWS = 100000;
const DIM = 384;
const CHUNKS = [256, 2048];
const REQUIRED = ['driver', 'rows', 'dim', 'chunk_bytes', 'run', 'cold_total_ms', 'match', 'precise_memory', 'machine', 'commit'];
const ALIASES = { chunk_size: 'chunk_bytes', chunkbytes: 'chunk_bytes', kind: 'run', run_kind: 'run', phase: 'run' };

// The real CSV has a boolean `restart` column (run = 1..6). Only a CSV without that column falls back to the old
// run-label alias (a run value that contains "restart").
const isRestart = (r) => ('restart' in r ? r.restart.toLowerCase() === 'true' : /restart/i.test(r.run));
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
const labelFor = (chunk, n) =>
  `localdata flat index, ${ROWS.toLocaleString('en-US')} x ${DIM} + ${chunk.toLocaleString('en-US')}-byte synthetic chunks, OPFS, cold open + first query (median / worst of ${n})`;

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF. Returns objects keyed by lower-case header. */
export function parseCsv(text) {
  const records = [];
  let row = [];
  let field = '';
  let quoted = false;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    if (!(row.length === 1 && row[0] === '')) records.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') pushField();
    else if (c === '\n') pushRow();
    else if (c === '\r') {
      if (text[i + 1] === '\n') i += 1;
      pushRow();
    } else field += c;
  }
  if (field !== '' || row.length > 0) pushRow();
  if (records.length === 0) return [];
  const header = records[0].map((h) => {
    const k = h.trim().toLowerCase();
    return ALIASES[k] ?? k;
  });
  return records.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const displayCommit = (c) => (c.endsWith('-dirty') ? `uncommitted working tree based on ${c.slice(0, -'-dirty'.length)}` : `commit ${c}`);

const notMeasured = (chunk) => ({
  benchmark: labelFor(chunk, 'N'),
  repo: 'localdata',
  command: COMMAND,
  dev: 'not measured',
  laptop: 'not measured',
  notes: `Sprint 4 done-when row. Filled by scripts/import-localdata-bench.mjs from ${CSV_CITE} once that file exists; no figure is typed by hand. The row is not measured on 8 GB: the 8 GB Windows laptop is the owner's step.`,
});

/**
 * The two rows for 256-byte and 2,048-byte chunks. `csvText` undefined (no CSV file) gives the "not measured" rows.
 * Throws, instead of showing a figure, when a column is missing, a size has no cold run, or any used row has match
 * other than true.
 */
export function buildLocaldataRows(csvText) {
  if (csvText === undefined) return CHUNKS.map(notMeasured);
  const records = parseCsv(csvText);
  if (records.length === 0) throw new Error(`${CSV_CITE}: no data rows`);
  const have = new Set(Object.keys(records[0]));
  for (const col of REQUIRED) if (!have.has(col)) throw new Error(`${CSV_CITE}: missing column ${col}`);
  const used = [];
  const rows = CHUNKS.map((chunk) => {
    const mine = records.filter(
      (r) => r.driver.toLowerCase() === 'opfs' && Number(r.rows) === ROWS && Number(r.dim) === DIM && Number(r.chunk_bytes) === chunk,
    );
    const cold = mine.filter((r) => !isRestart(r));
    const restart = mine.filter(isRestart);
    if (cold.length === 0) throw new Error(`${CSV_CITE}: no cold OPFS run at ${ROWS} x ${DIM} with ${chunk.toLocaleString('en-US')}-byte chunks`);
    for (const r of mine) {
      if (r.match.toLowerCase() !== 'true') throw new Error(`${CSV_CITE}: a ${chunk}-byte row has match=${r.match}; refusing to publish its timing`);
      if (!Number.isFinite(Number(r.cold_total_ms)) || r.cold_total_ms === '') throw new Error(`${CSV_CITE}: cold_total_ms is not a number: ${r.cold_total_ms}`);
    }
    used.push(...mine);
    const ms = cold.map((r) => Number(r.cold_total_ms));
    const restartMs = restart.map((r) => Number(r.cold_total_ms));
    const machine = [...new Set(mine.map((r) => r.machine))].join('; ');
    const restartText =
      restartMs.length === 0
        ? 'no browser-restart run in the CSV'
        : restartMs.length === 1
          ? `browser-restart run ${fmtInt(restartMs[0])} ms`
          : `browser-restart runs ${restartMs.map(fmtInt).join(', ')} ms`;
    return {
      chunk,
      machine,
      commits: [...new Set(mine.map((r) => r.commit))],
      precise: mine.every((r) => r.precise_memory.toLowerCase() === 'true'),
      row: {
        benchmark: labelFor(chunk, cold.length),
        repo: 'localdata',
        command: COMMAND,
        dev: `${machine}: median ${fmtInt(median(ms))} ms / worst ${fmtInt(Math.max(...ms))} ms of ${cold.length} cold runs; ${restartText}`,
        laptop: 'not measured',
      },
    };
  });
  return rows.map(({ machine, commits, precise, row }) => ({
    ...row,
    notes:
      `Sprint 4 done-when row: cold open plus the first query (k = 10) must stay under 2,000 ms on an 8 GB laptop; this machine has more memory, so the figure is not an 8 GB figure. ` +
      `Measured on ${machine} (machine column), ${commits.map(displayCommit).join('; ')} (commit column: ${commits.join(', ')}), by ${COMMAND} in localdata; match is true on every row. ` +
      `${precise ? 'JS heap was read with precise memory info enabled.' : 'Precise memory info was not enabled on every run.'} ` +
      `The row is not measured on 8 GB: the 8 GB Windows laptop is the owner's step.`,
    evidence: CSV_CITE,
  }));
}

/** Same layout as the committed file: top-level keys expanded, one row per line, so diffs show only changed rows. */
const rowJson = (r) => `{ ${Object.entries(r).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`;
function serialise(data) {
  const { rows, ...rest } = data;
  const head = JSON.stringify(rest, null, 2).replace(/\n}$/, '');
  return `${head},\n  "rows": [\n${rows.map((r) => `    ${rowJson(r)}`).join(',\n')}\n  ]\n}\n`;
}

const isMine = (r) => /^localdata flat index, /.test(r.benchmark);

/** Rewrites the two rows in <siteRoot>/data/benchmarks.json (in place, or after the localdata set/get row) and returns the rows. */
export function importBench({ siteRoot = SITE_ROOT, csvPath = SIBLING_CSV, write = true } = {}) {
  const file = join(siteRoot, 'data', 'benchmarks.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const rows = buildLocaldataRows(existsSync(csvPath) ? readFileSync(csvPath, 'utf8') : undefined);
  let at = data.rows.findIndex(isMine);
  const kept = data.rows.filter((r) => !isMine(r));
  if (at < 0) {
    const anchor = kept.findIndex((r) => /^localdata set\/get throughput/.test(r.benchmark));
    at = anchor >= 0 ? anchor + 1 : kept.length;
  }
  kept.splice(at, 0, ...rows);
  const next = serialise({ ...data, rows: kept });
  const changed = next !== readFileSync(file, 'utf8');
  if (write && changed) writeFileSync(file, next);
  return { rows, changed, file, csvUsed: existsSync(csvPath) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--csv');
  const csvPath = i >= 0 ? resolve(args[i + 1] ?? '') : SIBLING_CSV;
  const check = args.includes('--check');
  try {
    const r = importBench({ csvPath, write: !check });
    console.log(`import-localdata-bench: ${r.csvUsed ? `read ${csvPath}` : `no CSV at ${csvPath}; rows read "not measured"`}`);
    for (const row of r.rows) console.log(`  ${row.benchmark}\n    ${row.dev}`);
    if (check && r.changed) {
      console.error('data/benchmarks.json differs from these rows; run without --check');
      process.exit(1);
    }
    console.log(check ? 'data/benchmarks.json is up to date' : r.changed ? `wrote ${r.file}` : 'data/benchmarks.json already up to date');
  } catch (e) {
    console.error(`import-localdata-bench: ${e.message}`);
    process.exit(1);
  }
}
