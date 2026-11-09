#!/usr/bin/env node
// Zero-dependency static site build for Airplane Mode Labs.
//   node scripts/build.mjs            -> dist/
// Exports build({root, outDir}) for the tests. Refuses to emit any page that contains a
// script tag, a stylesheet or script from a non-allowed host, or an inline style attribute.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ALLOWED_RESOURCE_HOSTS = ['github.com', 'arxiv.org', 'doi.org'];

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function readMeta(fragment, key, fallback = '') {
  const m = new RegExp(`<!--\\s*${key}:\\s*([^\\n]*?)\\s*-->`).exec(fragment);
  return m ? m[1] : fallback;
}

function stripMeta(fragment) {
  return fragment.replace(/^(?:\s*<!--\s*[a-z-]+:[^\n]*-->\s*\n?)+/, '');
}

/** Throws when html breaks a rule. Anchors to other hosts are fine; resource loads are not. */
export function checkOutput(html, name) {
  if (/<script/i.test(html)) throw new Error(`refusing to build: ${name} contains <script`);
  if (/\sstyle="/i.test(html)) throw new Error(`refusing to build: ${name} has an inline style attribute`);
  const refs = [
    ...html.matchAll(/<(?:link|script)\b[^>]*?(?:href|src)="(https?:\/\/[^"/]+)/gi),
    ...html.matchAll(/@import\s+(?:url\()?["']?(https?:\/\/[^"'/)]+)/gi),
  ];
  for (const [, origin] of refs) {
    const host = new URL(origin).hostname;
    if (!ALLOWED_RESOURCE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
      throw new Error(`refusing to build: ${name} loads a resource from ${host}`);
    }
  }
}

function renderLayout(layout, { title, description, content, root, active, built }) {
  let html = layout
    .replaceAll('{{title}}', esc(title))
    .replaceAll('{{description}}', esc(description))
    .replaceAll('{{root}}', root)
    .replaceAll('{{built}}', esc(built))
    .replace('{{content}}', () => content);
  html = html.replace(/\{\{active:([a-z]+)\}\}/g, (_, page) => (page === active ? 'aria-current="page"' : ''));
  return html;
}

function paperRow(p) {
  const title = p.url ? `<a href="${esc(p.url)}" rel="noopener">${esc(p.title)}</a>` : esc(p.title);
  const cite = [p.authors.join(', '), p.year ?? '', p.venue ?? ''].filter(Boolean).map(esc).join(' · ');
  const repo = p.repo ? `<br /><span class="tag">${esc(p.repo)}</span>` : '';
  return `<tr class="paper" data-status="${esc(p.status)}" data-area="${esc(p.area)}">
  <td>${title}<br /><span class="muted">${cite}</span></td>
  <td><span class="tag">${esc(p.area)}</span>${repo}</td>
  <td class="paper-claim">${esc(p.claim)}</td>
  <td><span class="tag">${esc(p.status)}</span></td>
  <td>${esc(p.notes)}</td>
</tr>`;
}

function renderPapers(papers) {
  const byStatus = new Map();
  for (const p of papers) byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1);
  const summary = [...byStatus.entries()].map(([s, n]) => `${n} ${esc(s)}`).join(', ');
  return `<h1>Papers</h1>
<p class="lede">The reading list behind the tools: ${papers.length} papers, ${summary}. Status moves from
<em>to-read</em> through <em>reading</em>, <em>read</em>, <em>reproducing</em> to <em>reproduced</em> or
<em>not-reproduced</em>, and <em>write-up</em> once the note is published.</p>
<p class="muted">Citation rule: a title links to its source only after we fetched that source (arxiv.org, doi.org
or the standard's own page) and logged the fetch. Entries marked "citation to verify" have not been checked yet
and carry no link.</p>
<div class="table-wrap">
<table class="papers">
<thead><tr><th>Paper</th><th>Area</th><th>Claim</th><th>Status</th><th>Notes</th></tr></thead>
<tbody>
${papers.map(paperRow).join('\n')}
</tbody>
</table>
</div>`;
}

function renderBenchmarks(data) {
  const head = data.columns.map((c) => `<th>${esc(c)}</th>`).join('');
  const rows = data.rows
    .map(
      (r) =>
        `<tr><td>${esc(r.benchmark)}</td><td><span class="tag">${esc(r.repo)}</span></td><td><code>${esc(r.command)}</code></td><td>${esc(r.dev)}</td><td>${esc(r.laptop)}</td><td>${esc(r.notes)}</td></tr>`,
    )
    .join('\n');
  return `<p class="muted">${esc(data.note)}</p>
<div class="table-wrap">
<table class="benchmarks">
<thead><tr>${head}</tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>`;
}

export function build({ root, outDir }) {
  const srcDir = join(root, 'src');
  const layout = readFileSync(join(srcDir, 'templates', 'layout.html'), 'utf8');
  const built = new Date().toISOString().slice(0, 10);
  const outputs = [];

  const emit = (relPath, title, description, content, depth, active) => {
    const rel = '../'.repeat(depth);
    const html = renderLayout(layout, { title, description, content, root: rel, active, built });
    checkOutput(html, relPath);
    outputs.push([relPath, html]);
  };

  // Pages
  const pagesDir = join(srcDir, 'pages');
  const papers = JSON.parse(readFileSync(join(root, 'data', 'papers.json'), 'utf8'));
  const benchmarks = JSON.parse(readFileSync(join(root, 'data', 'benchmarks.json'), 'utf8'));
  for (const file of readdirSync(pagesDir).filter((f) => f.endsWith('.html')).sort()) {
    const name = basename(file, '.html');
    const fragment = readFileSync(join(pagesDir, file), 'utf8');
    const title = readMeta(fragment, 'title', name);
    const description = readMeta(fragment, 'description', 'Airplane Mode Labs');
    let content = stripMeta(fragment);
    if (content.includes('{{benchmarks-table}}')) {
      content = content.replace('{{benchmarks-table}}', () => renderBenchmarks(benchmarks));
    }
    if (name === 'index') emit('index.html', title, description, content, 0, 'index');
    else emit(join(name, 'index.html'), title, description, content, 1, name);
  }

  // Papers
  emit(
    join('papers', 'index.html'),
    'Papers',
    'The Airplane Mode Labs reading list: each paper with its claim, our status and notes.',
    renderPapers(papers),
    1,
    'papers',
  );

  // Write-ups
  const wuDir = join(root, 'writeups');
  const writeups = existsSync(wuDir) ? readdirSync(wuDir).filter((f) => f.endsWith('.html')).sort().reverse() : [];
  const items = [];
  for (const file of writeups) {
    const slug = basename(file, '.html');
    const fragment = readFileSync(join(wuDir, file), 'utf8');
    const title = readMeta(fragment, 'title', slug);
    const date = readMeta(fragment, 'date', '');
    const description = readMeta(fragment, 'description', title);
    emit(join('writeups', slug, 'index.html'), title, description, stripMeta(fragment), 2, 'writeups');
    items.push(`<li><a href="${esc(slug)}/">${esc(title)}</a>${date ? ` <span class="muted">${esc(date)}</span>` : ''}</li>`);
  }
  const wuIndex = `<h1>Write-ups</h1>
<p class="lede">What a paper claimed, what held up, what did not. Numbers are quoted with the command that
produced them. Prose is CC BY 4.0.</p>
${items.length ? `<ul class="writeup-list">\n${items.join('\n')}\n</ul>` : '<p class="muted">No write-ups yet.</p>'}`;
  emit(join('writeups', 'index.html'), 'Write-ups', 'Airplane Mode Labs write-ups.', wuIndex, 1, 'writeups');

  // Write everything only after every page passed the checks.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const [relPath, html] of outputs) {
    mkdirSync(dirname(join(outDir, relPath)), { recursive: true });
    writeFileSync(join(outDir, relPath), html);
  }
  const css = readFileSync(join(srcDir, 'styles.css'), 'utf8');
  if (/@import|url\(\s*["']?https?:/i.test(css)) throw new Error('refusing to build: styles.css loads a remote resource');
  copyFileSync(join(srcDir, 'styles.css'), join(outDir, 'styles.css'));
  writeFileSync(join(outDir, '.nojekyll'), '');
  return { pages: outputs.length, papers: papers.length, writeups: writeups.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = process.argv[2] ? process.argv[2] : join(root, 'dist');
  const result = build({ root, outDir });
  console.log(`build: ${result.pages} pages, ${result.papers} papers, ${result.writeups} write-ups -> ${outDir}`);
}
