# Airplane Mode Labs site

The lab's public site: the paper tracker, the benchmarks page and the write-ups, published to
GitHub Pages (see Demo below).

## Status

Live skeleton. The paper tracker holds the first 30 papers named or implied in the plans, all
still `to-read`. The benchmarks page is a scaffold whose every cell reads `not measured`. One
write-up exists: the Sprint 1 note, written from the tester reports. The demos page lists the
six public GitHub Pages demos with a hand-written, dated status each. Everything is plain HTML
with zero dependencies: no framework, no JavaScript on any page, no analytics, no third-party
fonts or scripts.

Package names use the placeholder scope `@airplanemode` / crate names `<repo>` until the
handles are reserved; nothing is published yet. This repository is a private package
(`@airplanemode/site`) and is never published to npm.

## Demo

Live demo: <https://airplanemode-labs.github.io/site/>. Built from `main` by
`.github/workflows/pages.yml` on every push; it shows only what works today and has a box titled
"What this demo does not do yet". It runs entirely in the browser: no upload, no analytics, no
third-party scripts or fonts.

The site is its own demo: the home page carries a Demos section and `/demos/` lists the six demo
URLs (pagetriage, runtime, glyphsift, localdata, dockit, site) with a one-line status and the
date it was written. Those statuses come from local builds served under `/<repo>/` on a
developer machine on 9 Nov 2026, not from the live URLs.

## Install

Node 22 or newer. Nothing to install: `package.json` has no dependencies and no
devDependencies.

```sh
git clone https://github.com/AirplaneMode-Labs/site
cd site
```

## Quick start

```sh
node scripts/build.mjs   # renders dist/
node --test              # builds into a temporary directory and checks the output
```

Open `dist/index.html` in a browser, or serve `dist/` with any static file server.

## How it works

`scripts/build.mjs` (Node, zero dependencies) reads `src/templates/layout.html`, wraps each
fragment in `src/pages/` into it, renders `data/papers.json` into `dist/papers/index.html`,
renders `data/benchmarks.json` into the table slot of `src/pages/benchmarks.html`, renders
`data/demos.json` into the table slot of `src/pages/demos.html` and into the Demos section of
the home page (refusing to build unless it holds exactly the six demos with matching URLs), wraps each
`writeups/*.html` fragment into `dist/writeups/<slug>/index.html` with an index, copies
`src/styles.css` and writes `.nojekyll`. Before writing anything it checks every page and
refuses to build if any output contains `<script`, loads a stylesheet or script from a host
other than github.com, arxiv.org or doi.org, or carries an inline `style=` attribute. Links to
other hosts (paper sources, for example) are allowed; resource loads are not.

Why zero dependencies: the site is a few pages that change weekly. A generator would add a
dependency tree to audit, an install step to CI and a framework to upgrade, for a benefit we do
not need. Astro or another generator can be reconsidered when the site outgrows this.

## Adding a paper

Append an object to `data/papers.json`:

```json
{
  "id": "short-slug-year",
  "title": "Exact title from the source",
  "authors": ["First Author", "Second Author", "et al."],
  "year": 2024,
  "venue": "arXiv:2406.17557",
  "url": "https://arxiv.org/abs/2406.17557",
  "area": "data-quality",
  "claim": "The paper's main claim in one sentence, in our own words.",
  "status": "to-read",
  "notes": "citation verified 2026-11-09 against arxiv.org abstract page",
  "repo": "glyphsift"
}
```

The citation rule: `url` and `venue` are written only after you fetched the source yourself
(arxiv.org, doi.org, or the standard's own page) during the same session and saved the fetch
log; the note says what was checked and when. An entry you have not checked carries status
`to-read`, note `citation to verify`, and neither `url` nor `venue`. No DOI is written unless it
was resolved. `node --test` enforces the shape; the log stays outside the repository.

Statuses: `to-read`, `reading`, `read`, `reproducing`, `reproduced`, `not-reproduced`,
`write-up`.

## Write-ups

See `writeups/README.md` for the format. Numbers are quoted with the command that produced
them; a sprint write-up is written from the tester reports after the sprint closes, or not at
all.

## Contracts

The site consumes no runtime contracts.

## Benchmarks

Not measured. The benchmarks page is a scaffold; a figure appears only when a named command
produced it on a named machine, and Apple-silicon figures are labelled placeholders until the
8 GB Windows no-GPU laptop has been measured.

## Limitations

- No search and no RSS feed.
- The demo statuses on `/demos/` are hand-written and dated, not measured at the live URLs.
- No scripts at all, by design; nothing on the site is interactive.
- Benchmarks are empty until measured; the paper tracker has no read papers yet.
- The Sprint 1 write-up quotes Apple-silicon figures only, labelled as placeholders; its
  fix-round paragraph is updated from the retest report once that report exists.
- The Sprint 2 write-up (`writeups/2026-11-sprint-2.html`) is a skeleton: every result slot reads
  "to be filled by the PO at wrap-up from <named command>" and holds no figure until then.
- The two Sprint 2 benchmark rows (glyphsift score versus noise; runtime same prompt on WebGPU
  and WASM with the SmolLM2-135M q4 test model) read "not measured" until a value is copied from
  that named command's output. The 8 GB Windows no-GPU column is "not measured" everywhere.
- The Sprint 2 demo statuses are hand-written from what each lane reported landing, then corrected
  to the tester's observations; they are not measured at the live URLs.
- The CSP is delivered by a meta tag; GitHub Pages cannot set response headers, so
  `frame-ancestors` and the cross-origin isolation headers are not set.
- Two paper entries (Howe 2011, LLM as Runtime Error Handler) are `citation to verify`: their
  sources could not be confirmed during the sprint run.

## Security and privacy

No analytics by design. The site runs no JavaScript, sets no cookies, loads nothing from a
third party and sends no telemetry. Each page carries
`Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none';
form-action 'none'` and `referrer: no-referrer`. The build refuses to emit a page that breaks
these rules. See SECURITY.md for the disclosure policy.

## Develop

```sh
node scripts/build.mjs          # build to dist/
node scripts/build.mjs /tmp/out # build elsewhere
node --test                     # run test/build.test.mjs
```

CI runs the same two commands on Linux, macOS and Windows; the Pages workflow builds, tests and
deploys `dist/` from `main`.

## Licence

Code (scripts, tests, templates, stylesheet, workflows): Apache-2.0, see LICENSE and NOTICE.
Prose and data (`writeups/`, `data/`, page text): CC BY 4.0, see LICENSE-CC-BY-4.0.
