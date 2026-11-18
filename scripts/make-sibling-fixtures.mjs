// Local-only: cuts the committed fixtures under test/fixtures/siblings/ from the sibling clones and the
// workspace evidence folder, and writes test/fixtures/siblings/SOURCE.json. Run it from a workspace that has
// the siblings next to this repository: `node scripts/make-sibling-fixtures.mjs`. CI never runs it.
//
// A repository file is read from its recorded commit (git show <commit>:<path>), never from a working tree,
// and the script refuses a file whose working-tree copy differs from that commit. Evidence and workspace
// files are not in a repository: their entries carry commit null and the sha256 of the source file.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import {
  FIXTURE_ROOT,
  SOURCE_JSON,
  SITE_ROOT,
  WORKSPACE_ROOT,
  REPOS,
  cutText,
  holdsPrivatePaths,
  splitCitation,
} from './sibling-fixtures.mjs';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const git = (repo, ...args) => execFileSync('git', ['-C', join(WORKSPACE_ROOT, repo), ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// ---- what is captured -------------------------------------------------------------------------------------

/** { 'repo\0path': cut } built up below. */
const want = new Map();
function add(repo, path, cut) {
  const key = `${repo}\0${path}`;
  const prev = want.get(key);
  if (!prev) return want.set(key, structuredClone(cut));
  if (prev.mode === 'whole' || cut.mode === 'whole') return want.set(key, { mode: 'whole' });
  prev.ranges = [...(prev.ranges ?? []), ...(cut.ranges ?? [])];
  prev.fragments = [...new Set([...(prev.fragments ?? []), ...(cut.fragments ?? [])])];
}
const whole = (repo, path) => add(repo, path, { mode: 'whole' });
const lines = (repo, path, { ranges = [], fragments = [] }) => add(repo, path, { mode: 'lines', ranges, fragments });

// Licence heads (licences.json test) and the licensing page's citations.
for (const r of ['glyphsift', 'localdata', 'runtime', 'dockit']) lines(r, 'LICENSE', { ranges: [[1, 10]] });
lines('pagetriage', 'LICENSE-APACHE', { ranges: [[1, 10]] });
lines('pagetriage', 'LICENSE-MIT', { ranges: [[1, 6]] });
lines('control-plane', 'LICENSE', { ranges: [[1, 12]] });
const licensing = readFileSync(join(SITE_ROOT, 'src', 'pages', 'licensing.html'), 'utf8');
for (const m of licensing.matchAll(/<!-- source: (.*?) \| (.*?) -->/g)) {
  const [path, fragment] = [m[1].replace(/:\d+$/, ''), m[2]];
  if (path.startsWith('site/')) continue; // site files are read from this repository
  const [repo, rest] = splitCitation(path);
  lines(repo, rest, { fragments: [fragment] });
}

// Benchmark sources and demo status sources.
whole('glyphsift', 'docs/score-vs-noise.csv');
whole('localdata', 'docs/benchmarks/vector-index.csv');

// evidence/sprint-3 files the Sprint 3 write-up tests compare figures against.
const E3 = 'sprint-3';
for (const f of [
  'T1/r3/runtime-ci.log', 'T1/r3/runtime-test-browser.log', 'T1/r3/runtime-test-model.log', 'T1/r3/runtime-test-worker.log',
  'T1/r3/runtime-test-devtools.log', 'T1/r3/localdata-test-browser.log', 'T1/r3/dockit-test-browser.log', 'T1/r3/localdata-ci.log',
  'T1/r3/dockit-ci-noenv.log', 'T1/r3/site-build-test.log', 'T1/r3/worker.json', 'T1/r3/artifact-hashes.log',
  'D1/SPEC-LANDED.txt', 'D1/devtools/devtools-figures.json', 'T1/r3/devtools/devtools-figures-t1.json', 'D1/LANDED.json',
]) whole('evidence', `${E3}/${f}`);
for (const f of ['cargo-test-glyphsift.full.log', 'cargo-test-pagetriage.full.log', 'cargo-test-control-plane.full.log']) {
  lines('evidence', `${E3}/T2/r2/${f}`, { fragments: ['test result: '] });
}
lines('evidence', `${E3}/S1/rv2/rv2-findings-append.md`, { fragments: ['glyphsift v0.1.0 tag NO-GO'] });

// evidence/sprint-4: D1's LANDED.json (the demos tests merge it with Sprint 3's).
whole('evidence', 'sprint-4/D1/LANDED.json');
// evidence/sprint-5: the status line of each demo (the architect copies the lane scratch folders to evidence/sprint-5 at wrap-up; until then they are read from scratch).
for (const f of ['D1/status-line.txt', 'D2/status-line.txt', 'D3/status-line.txt', 'D4/status-line.txt', 'D5/dockit-status-line.txt', 'D5/site-status-line.txt']) whole('evidence', `sprint-5/${f}`);
// dockit's real benchmark CSVs: from the commit once dockit is committed, from its working tree until then (the entry says which).
whole('dockit', 'docs/benchmarks/e2e.csv');
whole('dockit', 'docs/benchmarks/e2e-questions.csv');

// ---- cut ----------------------------------------------------------------------------------------------------

// the lane scratch folder (built from parts: this file must not carry the prefix itself, a test greps the repository for it)
const SCRATCH = process.env.AMLABS_SCRATCH ?? join(sep, 'private', 'tmp', 'airplanemode-team', 'sprint-5');

function readSource(repo, path) {
  if (repo === 'evidence' || repo === 'workspace') {
    const file = repo === 'evidence' ? join(WORKSPACE_ROOT, 'evidence', ...path.split('/')) : join(WORKSPACE_ROOT, ...path.split('/'));
    if (existsSync(file)) return { text: readFileSync(file, 'utf8'), commit: null, origin: 'file' };
    // Sprint 5 evidence is copied from the lane scratch folders at wrap-up; until then the scratch copy is the source
    const scratch = repo === 'evidence' && path.startsWith('sprint-5/') ? join(SCRATCH, ...path.slice('sprint-5/'.length).split('/')) : undefined;
    if (scratch && existsSync(scratch)) return { text: readFileSync(scratch, 'utf8'), commit: null, origin: 'scratch' };
    throw new Error(`source missing: ${repo}/${path}`);
  }
  if (!REPOS.includes(repo)) throw new Error(`unknown repo ${repo}`);
  const commit = git(repo, 'rev-parse', 'HEAD').trim();
  if (repo === 'dockit') {
    // dockit's benchmark CSVs are committed by the architect at wrap-up; before that the working-tree file is the source
    const at = execFileSync('git', ['-C', join(WORKSPACE_ROOT, repo), 'ls-tree', '--name-only', commit, '--', path], { encoding: 'utf8' }).trim();
    if (at === '') return { text: readFileSync(join(WORKSPACE_ROOT, repo, ...path.split('/')), 'utf8'), commit: null, origin: 'working-tree' };
  }
  const dirty = execFileSync('git', ['-C', join(WORKSPACE_ROOT, repo), 'status', '--porcelain', '--', path], { encoding: 'utf8' }).trim();
  // A file another lane has edited and not yet committed is still cut from its commit (that is what the fixture records); the live check
  // (npm run test:siblings) then reads the working-tree file, and a difference there is reported by that run, not hidden here.
  if (dirty) console.warn(`note: ${repo}/${path} differs from ${commit} in the working tree; cut from the commit`);
  return { text: git(repo, 'show', `${commit}:${path}`), commit, origin: 'commit' };
}

rmSync(FIXTURE_ROOT, { recursive: true, force: true });
const entries = [];
for (const [key, cut] of [...want].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const [repo, path] = key.split('\0');
  const { text, commit, origin } = readSource(repo, path);
  // a fixture whose cut would still hold the owner's home directory or a scratch path is recorded with redact 'paths' (T3-S5-11)
  if (holdsPrivatePaths(cutText(text, cut))) cut.redact = 'paths';
  const body = cutText(text, cut);
  if (Buffer.byteLength(body) > 100 * 1024) throw new Error(`${repo}/${path}: fixture over 100 KB`);
  const file = join(FIXTURE_ROOT, repo, ...path.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  entries.push({
    repo,
    commit,
    ...(origin === 'commit' || origin === 'file' ? {} : { origin }),
    path,
    cut,
    bytes: Buffer.byteLength(body),
    sha256: sha256(body),
    sourceSha256: sha256(text),
  });
}

// Index of every evidence path the Sprint 3 write-up cites (existence is checked against this, not the disk).
const writeup = readFileSync(join(SITE_ROOT, 'writeups', '2026-11-sprint-3.html'), 'utf8');
const cited = [...new Set([...writeup.matchAll(/evidence\/(sprint-3\/[A-Za-z0-9_./-]+[A-Za-z0-9_])/g)].map((m) => m[1]))].sort();
const files = {};
for (const rel of cited) {
  const file = join(WORKSPACE_ROOT, 'evidence', ...rel.split('/'));
  if (!existsSync(file)) throw new Error(`the Sprint 3 write-up cites a missing evidence file: ${rel}`);
  files[rel] = statSync(file).isDirectory() ? { directory: true } : { size: statSync(file).size, sha256: sha256(readFileSync(file)) };
}
const index = { note: 'Every evidence/sprint-3 path the Sprint 3 write-up cites, recorded when the fixtures were cut. Existence checks in CI read this index, not the disk.', files };
const indexBody = `${JSON.stringify(index, null, 2)}\n`;
writeFileSync(join(FIXTURE_ROOT, 'evidence', 'INDEX.json'), indexBody);
entries.push({ repo: 'evidence', commit: null, path: 'INDEX.json', cut: { mode: 'generated' }, bytes: Buffer.byteLength(indexBody), sha256: sha256(indexBody), sourceSha256: null });

const heads = Object.fromEntries(REPOS.filter((r) => r !== 'site').map((r) => [r, git(r, 'rev-parse', 'HEAD').trim()]));
writeFileSync(
  SOURCE_JSON,
  `${JSON.stringify(
    {
      note: 'Fixtures cut from the sibling repositories and the workspace evidence folder by scripts/make-sibling-fixtures.mjs. sha256 is the hash of the fixture file; sourceSha256 is the hash of the whole source file at the commit; cut says how the fixture was taken from it. npm run test:siblings (local only) re-derives every fixture from its source.',
      heads,
      files: entries,
    },
    null,
    2,
  )}\n`,
);
console.log(`wrote ${entries.length} fixtures under ${FIXTURE_ROOT}`);
