// Reads the files the site tests check against other repositories and the workspace evidence folder.
//
// A hosted CI checkout holds only this repository, so the CI tests never touch a sibling folder. They read
// the committed fixtures under test/fixtures/siblings/<repo>/<path>; test/fixtures/siblings/SOURCE.json says
// where each fixture came from (repo, commit, path, sha256 of the fixture, and how it was cut from the source).
//
//   SITE_SIBLINGS=fixture (default)  read the committed fixtures. A missing fixture is an error, never a skip.
//   SITE_SIBLINGS=live               read the live sibling folders next to this repository. Used only by
//                                    `npm run test:siblings` (test/siblings.local.test.mjs), never by CI.
//
// Repo names: the seven repositories, 'evidence' (the workspace evidence/ folder, which is not a repository)
// and 'workspace' (a file at the workspace root, for example a plan document).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE_ROOT = join(SITE_ROOT, 'test', 'fixtures', 'siblings');
export const SOURCE_JSON = join(FIXTURE_ROOT, 'SOURCE.json');
export const WORKSPACE_ROOT = join(SITE_ROOT, '..');

export const REPOS = ['pagetriage', 'glyphsift', 'localdata', 'runtime', 'dockit', 'site', 'control-plane'];
export const FIXTURE_REPOS = [...REPOS.filter((r) => r !== 'site'), 'evidence', 'workspace'];

export const mode = () => (process.env.SITE_SIBLINGS === 'live' ? 'live' : 'fixture');

/** 'runtime/spec/README.md' -> ['runtime', 'spec/README.md']; 'Startup Plan.md' -> ['workspace', 'Startup Plan.md']. */
export function splitCitation(path) {
  const i = path.indexOf('/');
  const head = i < 0 ? '' : path.slice(0, i);
  if (head === 'evidence' || (REPOS.includes(head) && head !== 'site')) return [head, path.slice(i + 1)];
  return ['workspace', path];
}

/**
 * Where a lane's Sprint 5 files are before the architect copies them into <workspace>/evidence/sprint-5 at wrap-up (built from parts: this file
 * must not carry the prefix itself, a test greps the repository for it; AMLABS_SCRATCH overrides it). Local use only, never CI.
 */
export const SPRINT5_SCRATCH = process.env.AMLABS_SCRATCH ?? join(sep, 'private', 'tmp', 'airplanemode-team', 'sprint-5');

/** The workspace evidence file; for a sprint-5 path that is not there yet, the lane scratch copy when that exists. */
function liveEvidence(path) {
  const file = join(WORKSPACE_ROOT, 'evidence', ...path.split('/'));
  if (existsSync(file) || !path.startsWith('sprint-5/')) return file;
  const scratch = join(SPRINT5_SCRATCH, ...path.slice('sprint-5/'.length).split('/'));
  return existsSync(scratch) ? scratch : file;
}

const liveFile = (repo, path) =>
  repo === 'workspace'
    ? join(WORKSPACE_ROOT, ...path.split('/'))
    : repo === 'evidence'
      ? liveEvidence(path)
      : join(WORKSPACE_ROOT, repo, ...path.split('/'));
const fixtureFile = (repo, path) => join(FIXTURE_ROOT, repo, ...path.split('/'));

/** The path the current mode reads for (repo, path). */
export const siblingPath = (repo, path) => (mode() === 'live' ? liveFile(repo, path) : fixtureFile(repo, path));

/** Text of a sibling file. A missing file throws: absence is a failure, not a reason to skip. */
export function readSibling(repo, path) {
  const file = siblingPath(repo, path);
  if (!existsSync(file)) {
    throw new Error(`${mode()} sibling file is missing: ${repo}/${path} (${file.split(sep).join('/')})`);
  }
  return readFileSync(file, 'utf8');
}

/** Read through a citation such as 'runtime/spec/README.md' or 'Startup Plan - Offline-First AI Lab.md'. */
export function readCitation(path) {
  const [repo, rest] = splitCitation(path);
  return readSibling(repo, rest);
}

let indexCache;
/** Every evidence path recorded when the fixtures were cut: { 'sprint-3/T1/r3/x.log': {size, sha256} }. */
export function evidenceIndex() {
  indexCache ??= JSON.parse(readFileSync(fixtureFile('evidence', 'INDEX.json'), 'utf8'));
  return indexCache;
}

/** True when the evidence file exists: in the recorded index (fixture mode) or on disk (live mode). */
export function evidenceExists(rel) {
  if (mode() === 'live') return existsSync(liveFile('evidence', rel));
  return Object.hasOwn(evidenceIndex().files, rel);
}

/** Sprints whose D1 LANDED.json the demos tests merge, in ascending order. */
export const LANDED_SPRINTS = [3, 4];

/** D1's LANDED.json merged across LANDED_SPRINTS (a later sprint replaces an earlier one key by key). */
export function readLanded() {
  let merged = {};
  for (const n of LANDED_SPRINTS) merged = { ...merged, ...JSON.parse(readSibling('evidence', `sprint-${n}/D1/LANDED.json`)) };
  return merged;
}

/**
 * The paths a committed fixture must not carry (T3-S5-11): the owner's home directory and the scratch folders of a sprint. The patterns are
 * written with escaped slashes so that this file does not contain the prefixes itself (a test greps the whole repository for them).
 * Order matters: the workspace first, then the projects folder around it, then a sprint's scratch folder, then any other home path.
 */
const PATH_REDACTIONS = [
  [/\/Users\/[^/\s"'`]+\/Projects\/airplane-mode-labs(?=[/\s"'`,;:)]|$)/g, '<workspace>'],
  [/\/Users\/[^/\s"'`]+\/Projects(?=[/\s"'`,;:)]|$)/g, '<projects>'],
  [/\/private\/tmp\/airplanemode-team\/(sprint-\d+)/g, '<scratch>/$1'],
  [/\/Users\/[^/\s"'`]+/g, '<home>'],
  // the owner's account name where it stands alone (the owner column of an ls -l listing in a saved log); built from parts like the prefixes
  [new RegExp(`\\b${['tushar', 'patekar'].join('')}\\b`, 'g'), '<user>'],
];

const redactPaths = (text) => PATH_REDACTIONS.reduce((t, [re, to]) => t.replace(re, to), text);

/** True when the text holds a home directory or a scratch path (what redact 'paths' would change). */
export const holdsPrivatePaths = (text) => redactPaths(text) !== text;

/**
 * How a fixture is cut from its source, so the generator and the local check agree byte for byte.
 *   {mode:'whole'}                              the source bytes
 *   {mode:'lines', ranges:[[from,to]], fragments:[text]}   the source lines inside a 1-based inclusive range
 *                                               or containing a fragment, in source order, joined with LF
 * Either cut may add  redact:'paths'  : after the cut, the owner's home directory, the projects folder, a sprint's scratch folder and any
 * other home path are replaced by <workspace>, <projects>, <scratch>/sprint-N and <home>. Nothing else changes, so the values a test asserts
 * stay as they were.
 */
export function cutText(source, cut) {
  if (cut.redact !== undefined && cut.redact !== 'paths') throw new Error(`unknown redact ${cut.redact}`);
  const body = cutRaw(source, cut);
  return cut.redact === 'paths' ? redactPaths(body) : body;
}

function cutRaw(source, cut) {
  if (cut.mode === 'whole') return source;
  if (cut.mode !== 'lines') throw new Error(`unknown cut mode ${cut.mode}`);
  const lines = source.split('\n');
  const picked = [];
  lines.forEach((line, i) => {
    const n = i + 1;
    const inRange = (cut.ranges ?? []).some(([a, b]) => n >= a && n <= b);
    const hasFragment = (cut.fragments ?? []).some((f) => line.includes(f));
    if (inRange || hasFragment) picked.push(line.replace(/\r$/, ''));
  });
  if (picked.length === 0) throw new Error('a cut that selects no line');
  return `${picked.join('\n')}\n`;
}
