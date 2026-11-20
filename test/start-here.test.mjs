import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build.mjs';

// Sprint 7 (B7): a "Start here" page for a visitor who has two minutes: the six demos, the four 'Try it in two minutes' sections that need no model
// download, the benchmarks and the limitations, with the size of dockit's download stated BEFORE its link. No script, no tracker, and no claim the
// repositories cannot back (nothing is published; the quick starts build from the repository).
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'amlabs-site-start-'));
build({ root, outDir: out });
const html = readFileSync(join(out, 'start-here', 'index.html'), 'utf8');
const demos = JSON.parse(readFileSync(join(root, 'data', 'demos.json'), 'utf8'));
const e2e = JSON.parse(readFileSync(join(root, 'data', 'e2e.json'), 'utf8'));
const hrefs = [...html.matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1]);

test('start-here is built, listed in the nav of every page, and is a real page (not a draft)', () => {
  assert.ok(existsSync(join(out, 'start-here', 'index.html')));
  assert.doesNotMatch(html, /name="robots" content="noindex"/);
  function walk(dir, acc = []) {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p, acc);
      else if (p.endsWith('.html')) acc.push(p);
    }
    return acc;
  }
  const pages = walk(out);
  assert.ok(pages.length >= 8);
  for (const p of pages) assert.match(readFileSync(p, 'utf8'), /<a href="(?:\.\.\/)*start-here\/"[^>]*>Start here<\/a>/, `${p}: the Start here nav link`);
});

test('start-here links the six demos (the URLs of data/demos.json), the four quick starts, the benchmarks and the limitations', () => {
  for (const d of demos) assert.ok(hrefs.includes(d.url), `demo link ${d.url}`);
  for (const repo of ['runtime', 'localdata', 'pagetriage', 'glyphsift']) {
    assert.ok(hrefs.includes(`https://github.com/AirplaneMode-Labs/${repo}#try-it-in-two-minutes`), `${repo}: the two-minute anchor`);
    assert.ok(hrefs.includes(`https://github.com/AirplaneMode-Labs/${repo}#limitations`), `${repo}: the limitations anchor`);
  }
  assert.ok(hrefs.includes('../benchmarks/'));
  assert.ok(hrefs.includes('https://github.com/AirplaneMode-Labs/dockit#limitations'));
});

test('every link is the page\'s own relative page, a built page, or one of the allowed hosts; external links carry rel="noopener noreferrer"', () => {
  for (const h of hrefs) {
    if (h.startsWith('https://')) {
      const host = new URL(h).hostname;
      assert.ok(['airplanemode-labs.github.io', 'github.com'].includes(host), `${h}: host ${host}`);
    } else if (h.startsWith('#')) assert.ok(html.includes(`id="${h.slice(1)}"`), `${h}: no such anchor`);
    else {
      const target = join(out, 'start-here', h);
      const file = target.endsWith('/') ? join(target, 'index.html') : target;
      assert.ok(existsSync(file), `${h}: not a built page`);
    }
  }
  for (const m of html.matchAll(/<a [^>]*href="https:\/\/[^"]*"[^>]*>/g)) assert.match(m[0], /rel="noopener noreferrer"/, m[0]);
});

test('start-here has no script, no form and no inline style, and loads nothing from a third party', () => {
  assert.doesNotMatch(html, /<script|<form|<iframe| style="|<link[^>]+href="https?:/i);
});

test('the dockit download size is stated before the dockit demo link, and is the stored size of data/e2e.json, not a typed figure', () => {
  const g = e2e.groups.find((x) => x.restart === false);
  const mb = Math.round(g.storage_usage_bytes.median / 1e6);
  const dockit = demos.find((d) => d.repo === 'dockit').url;
  const at = html.indexOf(`href="${dockit}"`);
  const size = html.indexOf(`about ${mb} MB`);
  assert.ok(size > 0, `the page says about ${mb} MB`);
  assert.ok(at > 0 && size < at, 'the size comes before the link');
  assert.match(html, /one time|once/i);
  assert.match(html, /model/i);
});

test('the quick starts are presented as needing no model download and no registry; nothing is claimed as published, audited, compliant or measured on 8 GB', () => {
  assert.match(html, /no model download/i);
  assert.match(html, /nothing is published|not published/i);
  assert.doesNotMatch(html, /\bpublished on\b|npm install @airplanemode|pip install (pagetriage|glyphsift)|cargo install|curl |\| sh/i);
  assert.doesNotMatch(html, /\baudited\b|\bcompliant\b|\bcompliance\b|certified|DPDP|RBI|saves? money|cheaper/i);
  assert.doesNotMatch(html, /(?<!not )measured on 8 GB/);
  assert.match(html, /not measured on 8 GB/);
});

test('start-here says plainly what it is not: no emulated or laptop figure, a text-layer PDF only, and the demos run in the tab', () => {
  assert.match(html, /text[- ]layer/i);
  assert.match(html, /nothing is uploaded|in the browser tab|in your browser/i);
});
