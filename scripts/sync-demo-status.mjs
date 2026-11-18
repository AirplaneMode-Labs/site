#!/usr/bin/env node
// Writes the six `status` lines of data/demos.json from the status-line.txt file each lane writes, so a line is never typed or edited here.
//   node scripts/sync-demo-status.mjs [--from <dir>] [--check]
//   --from   a folder laid out like evidence/sprint-5 (D1/status-line.txt ...); default <workspace>/evidence/sprint-5
//   --check  exit 1 when data/demos.json differs from what the files give (writes nothing)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

export function sync(from, { write = true } = {}) {
  const file = join(root, 'data', 'demos.json');
  const demos = JSON.parse(readFileSync(file, 'utf8'));
  for (const d of demos) {
    const src = join(from, ...SOURCES[d.repo].split('/'));
    if (!existsSync(src)) throw new Error(`${src} does not exist`);
    const line = readFileSync(src, 'utf8').trim();
    if (!/^Sprint \d+ \(\d{1,2} \w{3} 20\d\d\): /.test(line)) throw new Error(`${src}: not a status line`);
    d.status = line;
  }
  const next = `${JSON.stringify(demos, null, 2)}\n`;
  const changed = next !== readFileSync(file, 'utf8');
  if (write && changed) writeFileSync(file, next);
  return { changed, file };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--from');
  const from = i >= 0 ? resolve(args[i + 1] ?? '') : join(root, '..', 'evidence', 'sprint-5');
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
