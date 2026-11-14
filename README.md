# Airplane Mode Labs site

The lab's public site: the paper tracker, the benchmarks page and the write-ups, published to
GitHub Pages (see Demo below).

## Status

Live. The paper tracker holds the first 30 papers named or implied in the plans, all still
`to-read`. The benchmarks page shows the Sprint 2 and Sprint 3 figures that a named command
produced, each with its evidence path and labelled as an Apple-silicon placeholder, plus two
Sprint 3 slots (model-load timing per phase; memory at model load) that read `not measured`; the
8 GB Windows no-GPU column reads `not measured` everywhere. Two write-ups are published (Sprint 1 and
Sprint 2, the latter with a dated correction). The Sprint 3 write-up is an unlisted `noindex`
skeleton that the product owner finishes at wrap-up from real results, and `/licensing/` is an
unlinked `noindex` draft for owner review. The demos page lists the six public GitHub Pages demos with a
hand-written, dated status each (14 Nov 2026, from the browser tester's observations on local
builds). Everything is plain HTML with zero dependencies: no framework, no JavaScript on any page, no
analytics, no third-party fonts or scripts.

## Install

Node 22 or newer. Nothing to install: `package.json` has no dependencies and no
devDependencies.

```sh
git clone https://github.com/AirplaneMode-Labs/site
cd site
```

Not a registry package (the "Not published yet" sentence in the conventions does not apply here):
this repository is a private application (`@airplanemode/site`, `private: true`) that is built into
static files and deployed to GitHub Pages, never installed from npm, PyPI or crates.io. The npm scope
`@airplanemode` and the registry names are not reserved, and the name in `package.json` is a
placeholder.

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

### Adding a paper

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

### Write-ups

See `writeups/README.md` for the format. Numbers are quoted with the command that produced
them; a sprint write-up is written from the tester reports after the sprint closes, or not at
all.

## Contracts

The site consumes no runtime contracts.

## Demo

Live demo: <https://airplanemode-labs.github.io/site/>. Built from `main` by
`.github/workflows/pages.yml` on every push; it shows only what works today and has a box titled
"What this demo does not do yet". It runs entirely in the browser: no upload, no analytics, no
third-party scripts or fonts.

The site is its own demo: the home page carries a Demos section and `/demos/` lists the six demo
URLs (pagetriage, runtime, glyphsift, localdata, dockit, site) with a one-line status and the
date it was written. Those statuses come from local builds served under `/<repo>/` on a
developer machine on 14 Nov 2026, not from the live URLs.

## Licensing draft (owner step)

`/licensing/` is a draft licensing policy for owner review: unlinked, `noindex`, marked "Draft for
owner review. Not yet published as policy." Its table is generated from `data/licences.json`, read
against each sibling repository's LICENSE file, and its promises are the plan's literal
commitments; any wording beyond the plan text (the pagetriage dual-licence wording, what "the core"
covers, the open specs, contributions, trademarks) is marked `[owner to confirm]`. The Sprint 3 write-up
(`writeups/2026-11-sprint-3.html`) is likewise an unlisted, `noindex` skeleton with no figures.

A fragment becomes a draft by carrying `<meta name="draft" content="true" />`; the build then emits
`<meta name="robots" content="noindex" />` and leaves write-ups out of the list.

To publish the licensing page after approval, four edits in one change (the page is still marked as
a draft until all four are made):

1. In `src/templates/layout.html`, add the nav item `<a href="{{root}}licensing/">Licensing</a>`.
2. In `src/pages/licensing.html`, delete the `<meta name="draft" content="true" />` line, so the build
   stops adding `noindex`.
3. In the same file, delete the `<section class="box box-warn" id="draft-banner">` block
   (`#draft-banner`, the "Draft for owner review" banner) and resolve each `[owner to confirm]`.
4. In the same file, change the first comment line to `<!-- title: Licensing policy -->`, removing
   "(draft)" from the title, and update the description comment.

Then update the tests that pin the draft state (`no built page links to the licensing draft`, and the
draft assertions in `the licensing page is a built, unlinked, noindex draft ...`) and the demo statuses
if they should mention the page.

## Benchmarks

The 8 GB Windows no-GPU column reads `not measured` in every row. A figure appears only when a named
command produced it on a named machine, with the saved output cited as `evidence/sprint-N/<lane>/...`;
Apple-silicon figures are labelled placeholders until the 8 GB laptop has been measured. Today the
page carries the Sprint 2 WebGPU versus WebAssembly row (evidence/sprint-2/D1/model-run.json), the
glyphsift throughput row (evidence/sprint-2/D3/throughput.log) and the glyphsift score-versus-noise row,
whose mixed-family means were recomputed in Sprint 3 from the regenerated
`glyphsift/docs/score-vs-noise.csv` (evidence/sprint-3/D3/bench-s3.log). The two Sprint 3 rows
(model-load timing per phase; memory at model load) read `not measured` until the product owner copies
a value from a named command's output.

## Limitations

- No search and no RSS feed.
- The demo statuses on `/demos/` are hand-written and dated, not measured at the live URLs. The
  Sprint 3 lines (14 Nov 2026) come from the browser tester's observations of local builds served under
  `/<repo>/` and from runtime's LANDED.json: the runtime line claims the worker engine, the DevTools
  panel and Trusted Types (green there) and names WebLLM only as not yet (carried to Sprint 4).
- No scripts at all, by design; nothing on the site is interactive.
- Most benchmark cells read `not measured`; only rows with a named command and saved evidence carry a
  figure, all of them Apple-silicon placeholders. The paper tracker has no read papers yet.
- The Sprint 1 write-up quotes Apple-silicon figures only, labelled as placeholders; its
  fix-round paragraph is updated from the retest report once that report exists.
- The Sprint 2 write-up (`writeups/2026-11-sprint-2.html`) is finished from saved evidence and
  carries a dated correction (14 Nov 2026): WebLLM moved to Sprint 4, and its score-versus-noise table
  is the Sprint 2 one (the CSV was regenerated in Sprint 3).
- The licensing page is a draft: nothing on it is policy until the owner approves it and links it.
  It states no commitment beyond the plan text; its pagetriage dual-licence wording, what "the core"
  covers, the open specs, contributions, CLAs and trademarks are all `[owner to confirm]`.
- The Sprint 3 write-up is a skeleton with no figures, unlisted and `noindex`; the product owner fills
  it at wrap-up from real results.
- The CSP is delivered by a meta tag; GitHub Pages cannot set response headers, so
  `frame-ancestors` and the cross-origin isolation headers are not set.
- Two paper entries (Howe 2011, LLM as Runtime Error Handler) are `citation to verify`: their
  sources could not be confirmed during the sprint run.
- The tests read runtime's LANDED.json from `LANDED_JSON`, the workspace `evidence/sprint-3/D1/`
  copy or the local scratch copy; a clone with none of those skips the worker and Trusted Types
  cross-checks rather than guessing, and a clone without the glyphsift sibling skips the CSV
  cross-check.

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
