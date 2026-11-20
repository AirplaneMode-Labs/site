// The figures of data/benchmarks.json against the raw files that the sibling repositories COMMIT under docs/benchmarks/ (owner decision, 20 Nov 2026):
// a figure on the benchmarks page is the figure of a committed row, the row says when it was measured (date), on which commit and on which machine, and the
// page links to the file. This module holds the one place where each figure is recomputed from its file; test/bench-sources.test.mjs runs it against the
// committed fixtures (CI) and test/siblings.local.test.mjs against the live clones and against each sibling's HEAD (`npm run test:siblings`). Zero dependencies.
//
//   checkRows(rows, read)  ->  [problem, ...]   empty when every figure row agrees with its file
//
// `read(repo, path)` returns the text of a sibling file and throws when it is missing. A row is a figure row when its `dev` cell is not 'not measured'; it must
// have a stable `id`, the raw files it cites in `evidence` (each `<repo>/docs/benchmarks/<file>`), and `measured: { date, commit, machine, recordedIn }`.
import { createHash } from 'node:crypto';
import { buildLocaldataRows } from './import-localdata-bench.mjs';

export const REPOS_WITH_RAW = ['pagetriage', 'glyphsift', 'localdata', 'runtime', 'dockit'];
export const RAW_PATH = /\b(?:pagetriage|glyphsift|localdata|runtime|dockit)\/docs\/benchmarks\/[A-Za-z0-9._-]*[A-Za-z0-9_-]/g;
export const NOT_MEASURED = 'not measured';

/** The raw-file paths (`glyphsift/docs/benchmarks/x.json`) an evidence string names, in order. */
export const rawPaths = (evidence) => [...String(evidence ?? '').matchAll(RAW_PATH)].map((m) => m[0]);
/** 'glyphsift/docs/benchmarks/x.json' -> ['glyphsift', 'docs/benchmarks/x.json']. */
export const splitRaw = (path) => [path.slice(0, path.indexOf('/')), path.slice(path.indexOf('/') + 1)];
/** The GitHub page of a raw file on the main branch. */
export const rawUrl = (path) => {
  const [repo, rest] = splitRaw(path);
  return `https://github.com/AirplaneMode-Labs/${repo}/blob/main/${rest}`;
};

const num = (n) => Number(n).toLocaleString('en-US');
const num1 = (n) => Number(Number(n).toFixed(1)).toLocaleString('en-US');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
/** runtime records its commands with the output folder as a placeholder; the page leaves that variable out. */
const withoutOut = (c) => c.replace(/\s*RUNTIME_[A-Z_]*OUT=\S+/g, '').trim();

/** What a raw file says about itself: when (a day), which commit, which machine, which commands. Only the files the page cites have a reader. */
export function describeSource(path, read) {
  const [repo, rest] = splitRaw(path);
  if ((repo !== 'glyphsift' && repo !== 'runtime') || !rest.endsWith('.json')) throw new Error(`${path}: no reader for this raw file (the localdata rows are read by scripts/import-localdata-bench.mjs)`);
  const j = JSON.parse(read(repo, rest));
  if (repo === 'glyphsift') {
    if (!/^[0-9a-f]{40}$/.test(j.commit)) throw new Error(`${path}: commit is not 40 hex digits`);
    if (j.build_inputs_modified !== false) throw new Error(`${path}: build_inputs_modified is not false`);
    return { date: j.date.slice(0, 10), commit: j.commit.slice(0, 12), machine: j.machine, commands: [j.command] };
  }
  if (repo === 'runtime') {
    // runtime ran every file before Sprint 7 on a working tree and did not record a hash: the file says so, and names the base
    const commit = j.commit.recorded ? String(j.commit.sha).slice(0, 12) : `not recorded (base ${j.commit.base})`;
    return { date: j.measuredAt, commit, machine: j.machine.label, commands: j.commands.map(withoutOut) };
  }
  throw new Error(`${path}: no reader for a raw file of ${repo}`);
}

const GS = (name) => `glyphsift/docs/benchmarks/${name}`;
const RT = (name) => `runtime/docs/benchmarks/${name}`;

/**
 * For each figure row (by id): the raw files it must cite, the file that records its date, commit and machine, and the exact `dev` cell its files give.
 * A figure row with no entry here is a failure: a new figure needs its recomputation added here, with its file.
 */
const EXPECT = {
  'glyphsift-throughput': (read) => {
    const j = JSON.parse(read('glyphsift', 'docs/benchmarks/throughput-m5pro-48gb.json'));
    const best = Object.fromEntries(j.data.results.map((r) => [r.id, r.best_ms]));
    for (const id of ['native_check', 'wasm_validate', 'wasm_score_ppm']) if (!Number.isFinite(best[id])) throw new Error(`throughput file: no best_ms for ${id}`);
    return {
      evidence: [GS('throughput-m5pro-48gb.json')],
      recordedIn: GS('throughput-m5pro-48gb.json'),
      dev: `Best of ${j.data.runs_per_measurement === 5 ? 'five' : j.data.runs_per_measurement} runs: native glyphsift check: ${num(best.native_check)} ms; WASM validate(): ${num(best.wasm_validate)} ms; WASM score_ppm(): ${num(best.wasm_score_ppm)} ms`,
    };
  },
  'glyphsift-score-vs-noise': (read) => {
    const csv = read('glyphsift', 'docs/benchmarks/score-vs-noise.csv');
    const prov = JSON.parse(read('glyphsift', 'docs/benchmarks/score-vs-noise.provenance.json'));
    // the provenance file describes this very CSV: same bytes
    if (prov.data.csv_sha256 !== sha256(csv)) throw new Error('score-vs-noise.provenance.json: csv_sha256 is not the hash of score-vs-noise.csv');
    const [head, ...lines] = csv.trim().split('\n');
    const ix = Object.fromEntries(head.split(',').map((c, i) => [c, i]));
    const byP = new Map();
    for (const line of lines) {
      const f = line.split(',');
      if (f[ix.family] !== 'mixed') continue;
      if (!byP.has(f[ix.p])) byP.set(f[ix.p], []);
      byP.get(f[ix.p]).push(Number(f[ix.score_ppm]));
    }
    const ps = [...byP.keys()].sort((a, b) => Number(a) - Number(b));
    const means = ps.map((p) => Math.round(byP.get(p).reduce((a, b) => a + b, 0) / byP.get(p).length));
    const falls = means.every((m, i) => i === 0 || m < means[i - 1]);
    return {
      evidence: [GS('score-vs-noise.csv'), GS('score-vs-noise.provenance.json')],
      recordedIn: GS('score-vs-noise.provenance.json'),
      dev: `Mixed-family mean, ppm, at p = ${ps.join(', ')}: ${means.map(num).join('; ')}.${falls ? ' Falls at every step.' : ''}`,
    };
  },
  'runtime-webgpu-vs-wasm': (read) => {
    const j = JSON.parse(read('runtime', 'docs/benchmarks/model-answer-smollm2.json')).files[0].json;
    const leg = (l) => `load ${num(l.loadMs)} ms, prefill ${num(l.prefillMs)} ms, decode ${num(l.decodeMs)} ms, ${num1(l.tokensPerSecond)} tok/s`;
    return {
      evidence: [RT('model-answer-smollm2.json')],
      recordedIn: RT('model-answer-smollm2.json'),
      dev: `WebGPU: ${leg(j.webgpu)}. WASM: ${leg(j.wasm)}.${j.webgpu.outputText === j.wasm.outputText ? ' Same answer on both.' : ''}`,
    };
  },
  'runtime-load-phases': (read) => {
    const j = JSON.parse(read('runtime', 'docs/benchmarks/devtools-load-phases.json')).files[0].json;
    const p = j.panelPhaseDurationsMs;
    return {
      evidence: [RT('devtools-load-phases.json')],
      recordedIn: RT('devtools-load-phases.json'),
      dev: `Apple silicon, ${j.chrome}, WebAssembly engine in a worker (WebGPU was forced off in this run; WebGPU not measured here). One headed run: acquire ${num1(p.acquire)} ms, verify ${num1(p.verify)} ms, hand-off ${num1(p.handoff)} ms, session create ${num1(p.session)} ms, first token ${num1(p.first_token)} ms.`,
    };
  },
  'runtime-load-memory': (read) => {
    const j = JSON.parse(read('runtime', 'docs/benchmarks/devtools-load-phases.json')).files[0].json;
    const page = j.panelMemory.filter((m) => (m.scope ?? 'page') === 'page' && m.api === 'performance.memory');
    const at = (k) => page.find((m) => m.at === k)?.used;
    return {
      evidence: [RT('devtools-load-phases.json')],
      recordedIn: RT('devtools-load-phases.json'),
      dev: `Apple silicon, ${j.chrome}, page JS heap used (performance.memory, coarse). One headed run: ${at('before_load')} before load, ${at('after_session')} after session create, ${at('after_first_token')} after first token. The worker heap and WebAssembly memory were not exposed (source none), so there is no figure for them.`,
    };
  },
};

/** The localdata rows come from the importer, which writes the whole row (figure, notes, evidence, measured) from the CSV. */
const LOCALDATA_IDS = ['localdata-flat-256', 'localdata-flat-2048'];

/** Rows whose `dev` is not 'not measured'. */
export const figureRows = (rows) => rows.filter((r) => r.dev !== NOT_MEASURED);

/**
 * Every problem between the rows of data/benchmarks.json and the raw files read through `read`:
 * a figure row without an id, evidence or measured block, or with a figure that no file recomputes; evidence that is not a raw file of a sibling or that
 * the reader cannot find; a `dev` cell that differs from what the file gives; a date, commit, machine or command that is not the file's.
 */
export function checkRows(rows, read) {
  const problems = [];
  const seen = new Set();
  for (const r of rows) {
    if (r.dev === NOT_MEASURED) {
      if (r.evidence !== undefined || r.measured !== undefined) problems.push(`${r.benchmark}: reads not measured but cites evidence`);
      continue;
    }
    const name = r.id ?? r.benchmark;
    if (typeof r.id !== 'string' || r.id === '') {
      problems.push(`${r.benchmark}: a figure row has no id`);
      continue;
    }
    if (seen.has(r.id)) problems.push(`${name}: duplicate id`);
    seen.add(r.id);
    const cited = rawPaths(r.evidence);
    if (cited.length === 0) problems.push(`${name}: a figure without a raw file of a sibling in its evidence (${JSON.stringify(r.evidence)})`);
    // the evidence string holds raw paths and the word 'and' and nothing else
    if (String(r.evidence ?? '').replace(RAW_PATH, '').replace(/\band\b|[\s,;]/g, '') !== '') problems.push(`${name}: evidence holds more than raw file paths: ${JSON.stringify(r.evidence)}`);
    for (const p of cited) {
      try {
        read(...splitRaw(p));
      } catch (e) {
        problems.push(`${name}: ${p} cannot be read (${e.message})`);
      }
    }
    if (typeof r.measured !== 'object' || r.measured === null) {
      problems.push(`${name}: a figure row has no measured block (date, commit, machine)`);
      continue;
    }
    if (r.laptop !== 'not measured on 8 GB') problems.push(`${name}: the 8 GB cell does not read 'not measured on 8 GB'`);
    if (LOCALDATA_IDS.includes(r.id)) {
      const want = buildLocaldataRows(read('localdata', 'docs/benchmarks/vector-index.csv')).find((x) => x.id === r.id);
      if (JSON.stringify(r) !== JSON.stringify(want)) problems.push(`${name}: the row is not what scripts/import-localdata-bench.mjs gives for localdata/docs/benchmarks/vector-index.csv`);
      continue;
    }
    const expect = EXPECT[r.id];
    if (expect === undefined) {
      problems.push(`${name}: no recomputation of this figure from a committed file (add it to EXPECT in scripts/bench-sources.mjs)`);
      continue;
    }
    let want;
    try {
      want = expect(read);
    } catch (e) {
      problems.push(`${name}: ${e.message}`);
      continue;
    }
    if (r.dev !== want.dev) problems.push(`${name}: the figure is not the committed one.\n  row:  ${r.dev}\n  file: ${want.dev}`);
    if (JSON.stringify([...cited].sort()) !== JSON.stringify([...want.evidence].sort())) problems.push(`${name}: evidence ${JSON.stringify(cited)} is not ${JSON.stringify(want.evidence)}`);
    if (r.measured.recordedIn !== want.recordedIn) problems.push(`${name}: measured.recordedIn is ${r.measured.recordedIn}, not ${want.recordedIn}`);
    let src;
    try {
      src = describeSource(want.recordedIn, read);
    } catch (e) {
      problems.push(`${name}: ${e.message}`);
      continue;
    }
    for (const k of ['date', 'commit', 'machine']) if (r.measured[k] !== src[k]) problems.push(`${name}: measured.${k} is ${JSON.stringify(r.measured[k])}, the file says ${JSON.stringify(src[k])}`);
    if (!src.commands.includes(r.command)) problems.push(`${name}: command ${JSON.stringify(r.command)} is none of the file's commands ${JSON.stringify(src.commands)}`);
  }
  return problems;
}
