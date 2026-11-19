#!/usr/bin/env node
// Writes the six `status` lines of data/demos.json (and each `writtenOn`) from the status-line.txt file each lane writes, so a line is never
// typed or edited here.
//   node scripts/sync-demo-status.mjs [--from <dir>] [--check]
//   --from   a folder laid out like evidence/sprint-<SPRINT> (D1/status-line.txt ...). Default: <workspace>/evidence/sprint-<SPRINT> once the
//            architect has copied it there at wrap-up, else the lane scratch folder of that sprint (TD-78). SPRINT is one constant in
//            scripts/sibling-fixtures.mjs.
//   --check  exit 1 when data/demos.json differs from what the files give (writes nothing)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPRINT, SPRINT_SCRATCH, WORKSPACE_ROOT } from './sibling-fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
export const SOURCES = {
  runtime: 'D1/status-line.txt',
  pagetriage: 'D2/status-line.txt',
  glyphsift: 'D3/status-line.txt',
  localdata: 'D4/status-line.txt',
  dockit: 'D5/dockit-status-line.txt',
  site: 'D5/site-status-line.txt',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LINE_HEAD = /^Sprint \d+ \((\d{1,2}) (\w{3}) (20\d\d)\): /;

/** 'Sprint 6 (19 Nov 2026): ...' gives '2026-11-19' (the date a line was written is the date inside it). */
export function dateOfLine(line) {
  const m = LINE_HEAD.exec(line);
  if (!m) throw new Error(`not a status line: ${line.slice(0, 40)}`);
  const month = MONTHS.indexOf(m[2]);
  if (month < 0) throw new Error(`not a date: ${m[1]} ${m[2]} ${m[3]}`);
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** The folder a sync reads when --from is not given. `exists` is a parameter so a test can run both branches on any machine. */
export function defaultFrom({ exists = existsSync } = {}) {
  const evidence = join(WORKSPACE_ROOT, 'evidence', `sprint-${SPRINT}`);
  return exists(evidence) ? evidence : SPRINT_SCRATCH;
}

export function sync(from, { write = true } = {}) {
  const file = join(root, 'data', 'demos.json');
  const demos = JSON.parse(readFileSync(file, 'utf8'));
  for (const d of demos) {
    const src = join(from, ...SOURCES[d.repo].split('/'));
    if (!existsSync(src)) throw new Error(`${src} does not exist`);
    const line = readFileSync(src, 'utf8').trim();
    if (!LINE_HEAD.test(line)) throw new Error(`${src}: not a status line`);
    d.status = line;
    d.writtenOn = dateOfLine(line);
  }
  const next = `${JSON.stringify(demos, null, 2)}\n`;
  const changed = next !== readFileSync(file, 'utf8');
  if (write && changed) writeFileSync(file, next);
  return { changed, file };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--from');
  const from = i >= 0 ? resolve(args[i + 1] ?? '') : defaultFrom();
  const check = args.includes('--check');
  try {
    const r = sync(from, { write: !check });
    if (check && r.changed) {
      console.error('data/demos.json differs from the status-line files; run without --check');
      process.exit(1);
    }
    console.log(check ? 'data/demos.json is up to date' : r.changed ? `wrote ${r.file}` : 'data/demos.json already up to date');
  } catch (e) {
    console.error(`sync-demo-status: ${e.message}`);
    process.exit(1);
  }
}
