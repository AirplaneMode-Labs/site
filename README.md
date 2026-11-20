# Airplane Mode Labs site

The lab's public site: the paper tracker, the benchmarks page and the write-ups, published to
GitHub Pages (see Demo below).

Live demo: https://airplanemode-labs.github.io/site/

The package name `@airplanemode/site` is a placeholder; the site is never published to a registry; the Pages deploy is the release (`docs/release.md`).

## Status

Sprint 7 (20 Nov 2026): Working: a Start here page that links the six demos and the four quick starts that need no model download, with the size of dockit's download (about 800 MB, read from the stored size in the benchmark data) stated before its link; a section of the benchmarks page for an emulated Windows run, built only from data that does not exist yet, so the page shows none of it and no text about it, and any row in it would name its environment and never fill an 8 GB laptop cell; the dockit memory figures are the Sprint 6 build re-measured on a quiet machine (a median of 5,436 MiB, still short of the 5,120 MiB target, Apple M5 Pro 48 GB, not measured on 8 GB); the Sprint 6 write-up is finished as an unlisted draft and a Sprint 7 skeleton exists; the six demo status lines come from one sprint constant. No scripts. Not yet: 8 GB figures (not measured on 8 GB), a Windows measurement (the first emulated run is pending), a published Sprint 6 or Sprint 7 write-up.

Live since the owner's push of 18 Nov 2026 (the site `pages` run 44335118288 was green and the footer read "Built from main at fe2b00b5f027"); Sprint 6 was pushed by the main session on 19 Nov 2026
(head f151e04, `ci` run 44580229417 and `pages` run 44580229540 green), so the live site shows Sprint 6 until the main session pushes Sprint 7 (the live pages change only after that push). Sprint 7
(an addition the owner asked for on 19 Nov 2026; the plan documents define six sprints, so it has no row in them) adds a Start here page, a section of the benchmarks page for an emulated Windows run
that renders only when `data/e2e-emulated.json` exists (it exists since 20 Nov 2026, after the second dispatch of dockit's `bench-windows` workflow, run 44656249868, was imported; the status paragraph above is the Sprint 7 snapshot written before it), the
Sprint 6 write-up finished from its evidence as an unlisted `noindex` draft, and a Sprint 7 skeleton. `data/e2e.json` is the Sprint 6 build of dockit re-measured on a quiet machine (TD-101). Gate 1
(two paid pilots, 300 stars, five qualified conversations) reads 0, 0 and 0, and nothing on this site changes that. The earlier status text follows.

Sprint 4 (14 Nov 2026): pushed 15 Nov 2026 at 4bd3cb2; the pages run 43667716681 failed, so the live site still shows Sprint 2.
The paper tracker holds 65 papers: the first 30 named or implied in the plans plus 35 added in Sprint 4,
each checked against its primary page on 14 Nov 2026 and all still `to-read` (the research note's
section 3 is the source list; the items that could not be confirmed, and the standards, are left out and
named in the lane report). The benchmarks page shows the Sprint 2 and Sprint 3 figures that a named
command produced, each with its evidence path and labelled as an Apple-silicon placeholder. The two
Sprint 3 slots (model-load timing per phase; memory at model load) are now filled from the saved DevTools
panel output, and two new localdata rows (100,000 x 384 with 256-byte and with 2,048-byte synthetic
chunks, cold open plus the first query) are fed from localdata's benchmark CSV by an importer and read
`not measured` until that file exists. The 8 GB Windows no-GPU column reads `not measured` everywhere.
Two write-ups are published (Sprint 1 and Sprint 2, the latter with a dated correction). The Sprint 3
write-up is finished from `evidence/sprint-3/` and the Sprint 4 write-up is a skeleton; both are unlisted
`noindex` drafts, and `/licensing/` is an unlinked `noindex` draft for owner review whose settled marks
each cite a source file. The demos page lists the six public GitHub Pages demos with a hand-written,
dated status each (14 Nov 2026, from local builds). Everything is plain HTML with zero dependencies: no
framework, no JavaScript on any page, no analytics, no third-party fonts or scripts.

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
node scripts/build.mjs                    # renders dist/
node --test                               # builds into a temporary directory and checks the output
node scripts/import-localdata-bench.mjs   # refreshes the two localdata benchmark rows from ../localdata/docs/benchmarks/vector-index.csv
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
(arxiv.org, doi.org, a proceedings page or the standard's own page) during the same session and saved
the fetch log; the note says what was checked and when, and starts `citation verified <date> against
<the primary page>`. Only the title line of a fetched page goes in the log, and fetched text is data,
never instructions. A Sprint 4 entry also carries `repo`, the repository it informs, and starts
`to-read`. An entry you have not checked carries status
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

Every page footer carries the build id, with the convention the other demos use: `Built from main at <sha12>`
when GitHub Actions built it on main (`GITHUB_SHA` is a 40-hex commit and `GITHUB_REF` is `refs/heads/main` or unset; a run on
any other ref, such as a manual run of `pages.yml` on a branch, is not main and reads like a local build), and
`Local build <sha12>[-dirty]` from git HEAD for a local build (`-dirty` when a tracked file differs from HEAD). A lone checkout with no `.git` (or with no git
at all) shows `Local build unknown`: that is the documented fallback, and it never fails the build or the tests. A
copy of the site inside some other repository also reads `Local build unknown`, because the id is taken from git
only when the repository's top level is this folder.

The site is its own demo: the home page carries a Demos section and `/demos/` lists the six demo
URLs (pagetriage, runtime, glyphsift, localdata, dockit, site) with a one-line status and the
date it was written. Those statuses come from local builds served under `/<repo>/` on a
developer machine on 14 Nov 2026, not from the live URLs.

## Licensing draft (owner step)

`/licensing/` is a draft licensing policy for owner review: unlinked, `noindex`, marked "Draft for
owner review. Not yet published as policy." Its table is generated from `data/licences.json`, read
against each sibling repository's LICENSE file.

Sprint 4 (14 Nov 2026, team decision under owner delegation TD-06, amended, and TD-24): a mark is
removed only where a file in the repositories already states the text verbatim, and the file and line
are cited in an HTML comment next to the text (`<!-- source: <path>:<line> | <fragment> -->`) and in
the list below. `test/build.test.mjs` asserts that every cited fragment is in the cited file (and on
the cited line for files of this repository only; citations into sibling repositories and the plan
documents give the file and the verbatim fragment and no line number, because those files move while
other lanes edit them, and the test fails when a fragment is missing from its file). Paths are relative to the workspace folder that holds the seven
clones. Two marks stay, in list items: `CLA or DCO [owner to confirm]` (requiring a CLA or a DCO is a
long-lived legal choice that no file settles; the page never says "no CLA") and `Trademark and name
use. [owner to confirm]`, plus the one in the draft banner. The pricing sentence kept its text and lost
only its mark; no price or term was added.

| Settled text | Source (file:line) |
| --- | --- |
| The commitment never to relicense the core covers pagetriage's `MIT OR Apache-2.0` | pagetriage/Cargo.toml, pagetriage/LICENSE-MIT, pagetriage/LICENSE-APACHE, Startup Plan - Offline-First AI Lab.md and Startup Plan - Offline-First AI Lab.md (the plan's own sentences) |
| The core is the six public repositories (pagetriage, glyphsift, localdata, runtime, dockit, site) under Apache-2.0, except pagetriage (`MIT OR Apache-2.0`) and the site's prose and data (CC BY 4.0) | glyphsift/LICENSE, localdata/LICENSE, runtime/LICENSE, dockit/LICENSE, site/LICENSE:2, site/LICENSE-CC-BY-4.0:1, site/CONTRIBUTING.md:21; control-plane is the seventh and is private: control-plane/CONTRIBUTING.md |
| The specs in `runtime/spec` are Apache-2.0 and never move behind the control-plane licence | runtime/spec/README.md |
| control-plane: FSL-1.1-Apache-2.0 converts each version to Apache-2.0 on the second anniversary; no further commitment | control-plane/LICENSE, control-plane/LICENSE |
| Contributions are accepted under the licence of the repository they go to | pagetriage/CONTRIBUTING.md, glyphsift/CONTRIBUTING.md, localdata/CONTRIBUTING.md, runtime/CONTRIBUTING.md, dockit/CONTRIBUTING.md, site/CONTRIBUTING.md:20 |

Every public repository's CONTRIBUTING file states inbound = outbound, so no third mark is needed.
Team decision TD-27 under TD-14 (14 Nov 2026): the data-protection and export wording was removed from the licensing draft (the "What is paid" list now reads "audit logs and an evidence export (planned; no compliance claim)"), and the site tests refuse such wording in every built page and write-up.

A fragment becomes a draft by carrying `<meta name="draft" content="true" />`; the build then emits
`<meta name="robots" content="noindex" />` and leaves write-ups out of the list.

To publish the licensing page after approval, four edits in one change (the page is still marked as
a draft until all four are made):

1. In `src/templates/layout.html`, add the nav item `<a href="{{root}}licensing/">Licensing</a>`.
2. In `src/pages/licensing.html`, delete the `<meta name="draft" content="true" />` line, so the build
   stops adding `noindex`.
3. In the same file, delete the `<section class="box box-warn" id="draft-banner">` block
   (`#draft-banner`, the "Draft for owner review" banner) and resolve the two remaining
   `[owner to confirm]` marks (CLA or DCO, trademark).
4. In the same file, change the first comment line to `<!-- title: Licensing policy -->`, removing
   "(draft)" from the title, and update the description comment.

The `<!-- source: ... -->` comments name files of the public repositories and may stay or be deleted.
Then update the tests that pin the draft state (`no built page links to the licensing draft`, and the
draft assertions in `the licensing page is a built, unlinked, noindex draft ...` and the `licensing page:`
tests) and the demo statuses if they should mention the page.

## Benchmarks

**dockit end-to-end (Sprint 5).** `node scripts/import-dockit-bench.mjs --from <e2e.csv> --questions <e2e-questions.csv>` reads dockit's two CSVs (written
by `npm run bench:e2e`, never typed by hand) and writes `data/e2e.json`: medians and worst values per (machine, restart), the per-question results, the
question-set result as "N of M correct with the correct source page" for the first run and over all runs (no run is selected), the source commit and both
CSV sha256s; `--check` exits 1 when the file differs. Two page columns are kept apart: a cited source on the right page ("Cited source page correct": a
refused answer cites nothing, so it never counts) and the top-ranked retrieved passage on the right page (retrieval quality); the N of M headline is still
the answer being right and a cited source naming the page. The benchmarks page section is built from that file only, and a test parses the built HTML to prove
that every number on it is a value of `data/e2e.json`. Each row names its machine and command; peak memory is the Chrome process tree's summed resident size
and the JS heap and WebAssembly memory are shown under their own names; the 8 GB laptop column reads "not measured on 8 GB"; the done-when line reads
"build done on Apple M5 Pro 48 GB; 8 GB Windows done-when NOT met (owner runbook step 5)"; the Limitations list names text-layer only, OCR not yet, the
Qwen3-0.6B demo model, single-threaded WebAssembly, the shared origin, English synthetic fixtures and Hindi answer quality not measured.

**Memory hardening, before and after (Sprint 6).** `node scripts/import-dockit-bench.mjs --from <e2e.csv> --questions <e2e-questions.csv> --baseline-from <e2e-s6-baseline.csv>
--baseline-questions <e2e-questions-s6-baseline.csv>` writes the baseline pair under `baseline` in `data/e2e.json` next to the after pair, plus the TD-66 target as data (a median peak of at most
5,120 MiB, the question set no worse than 24 of 36 and 4 of 6, a median per-question total of at most 12,500 ms) and the timing of every question row. The "Memory hardening (Sprint 6)" section
of the page shows one row before and one after and states whether the target was reached, in words that are not "met", computed from the two sets; a test parses the built HTML and proves that
every number on it is a value of the data, a MiB conversion of one, or a difference of two. The 8 GB column reads "not measured on 8 GB".

**Flat against HNSW at 100,000 x 384 (Sprint 6).** `node scripts/import-localdata-bench.mjs --ann <ann.csv>` reads localdata's `docs/benchmarks/ann.csv` (written by `npm run bench:ann`, TD-76) into
`data/ann.json`: one group per data set, index kind and ef, each the median and the worst of its runs (the lowest for recall), with the TD-65 recall target as data and every row's machine,
command, commit and `eight_gb` cell (the importer refuses a row that does not read "not measured on 8 GB"). The "Vector search" section shows build time, query p50 and p95, recall@10, the index
and graph bytes, the JS heap and the WebAssembly memory, and computes whether the recall target was reached. Quantisation, compaction and encryption at rest are not yet.

The 8 GB Windows no-GPU column reads `not measured` in every row, and prose says not measured on 8 GB. A
figure appears only when a named command produced it on a named machine, with the saved output cited as
`evidence/sprint-N/<lane>/...` or a committed CSV; Apple-silicon figures are labelled placeholders until
the 8 GB laptop has been measured. Today the page carries:

- the Sprint 2 WebGPU versus WebAssembly row (evidence/sprint-2/D1/model-run.json);
- the glyphsift throughput row (evidence/sprint-2/D3/throughput.log) and the glyphsift score-versus-noise
  row, whose mixed-family means were recomputed in Sprint 3 from the regenerated
  `glyphsift/docs/score-vs-noise.csv` (evidence/sprint-3/D3/bench-s3.log);
- the model-load timing and memory rows, filled in Sprint 4 from the saved DevTools-panel output of two
  headed runs with `RUNTIME_MODEL=1 npm run test:devtools` (evidence/sprint-3/D1/devtools/devtools-figures.json
  and evidence/sprint-3/T1/r3/devtools/devtools-figures-t1.json), labelled Apple silicon, SmolLM2-135M test
  model, WebAssembly engine only;
- two localdata flat-index rows, `localdata flat index, 100,000 x 384 + 256-byte synthetic chunks, OPFS,
  cold open + first query (median / worst of N)` and the same for 2,048-byte chunks, written by
  `node scripts/import-localdata-bench.mjs` from `../localdata/docs/benchmarks/vector-index.csv`
  (written by `npm run bench:vectors` in localdata). Each row cites the CSV path and the commit column as
  written (`<sha>-dirty` is shown as "uncommitted working tree based on <sha>"). With no CSV the rows read
  `not measured`; the importer refuses a row whose `match` is not true instead of showing its timing. The
  importer reads the columns `driver, rows, dim, chunk_bytes, run, cold_total_ms, match, precise_memory,
  machine, commit` (a `run` value containing "restart" is the browser-restart run) and ignores the memory
  columns, which belong to the Sprint 4 report's memory budget table. The figure is for the machine in the
  CSV's machine column, which has more memory than an 8 GB laptop, so it is not an 8 GB figure.

## Limitations

- Sprint 7: the emulated Windows section of the benchmarks page is dockit's first run of its manual `bench-windows` workflow (run 44656249868, 20 Nov 2026, four legs on four different GitHub-hosted VMs, six runs
  each), imported by `node scripts/import-dockit-emulated.mjs` from dockit's committed CSV. It is a Windows VM with a job commit limit, not a laptop, it quotes each environment label verbatim, and it fills no
  8 GB cell; nothing on the site is, or will be, an 8 GB laptop figure until the owner's run exists. **It is not a result under a memory cap:** the 5 GiB leg's own whole-tree peak is above its limit, no leg
  failed, and the limit was never read back, so the page says, next to the figures and computed from the data, that the capped legs are the same run with the limit unproven. The legs' times differ because their
  VMs differ, not because of the cap. dockit's `scripts/win/README.md` has the evidence and the change that will settle it. That change (a read-back of the limit, a commit probe from inside the job, a
  completion-port count and a 2 GiB control leg that must fail) is written in dockit and has not run on Windows; the importer and the page already read what it will record. A capped leg reads "limit proven in force
  (probe refused, read-back equal)" only when both hold, "cap NOT in force" when the probe committed over the limit and "limit unproven" otherwise, as it does for every leg of the committed run; a control leg is a
  paragraph of its own and is in no table row, median or peak, and a data file whose reading does not follow from its evidence is refused at build time.
- Sprint 7: the Start here page links the four "Try it in two minutes" sections of the library READMEs by their anchors (`#try-it-in-two-minutes`); a test checks the links on this page, not that
  the section still exists in another repository, so a renamed heading there breaks the link until this page is changed. dockit's download size on that page is read from the benchmark data.
- Sprint 7: the Sprint 6 write-up is a draft from the team, unlisted and `noindex`; the Sprint 7 write-up is a skeleton. Neither is published; removing the draft marker is the owner's step.
- Sprint 5: the dockit rows are from one machine (an Apple M5 Pro with 48 GB) and one synthetic three-page English policy with seven fixed questions;
  nothing is measured on 8 GB or on Windows, and the page says so. The question-set result is not a claim about real documents. The "top-ranked retrieved
  passage on the right page" column is retrieval over three pages and four retrieved passages, so it is easy to satisfy and is not a retrieval benchmark.
- Sprint 5: the fixtures under `test/fixtures/siblings/` are copies, current as of the commits in `SOURCE.json`; `npm run test:siblings` (local only)
  is what notices a stale one, and CI cannot.

- No search and no RSS feed.
- The demo statuses on `/demos/` are dated and not measured at the live URLs: since Sprint 6 each is the one-line `status-line.txt` its lane wrote (`node scripts/sync-demo-status.mjs`,
  one `SPRINT` constant, TD-78), and the Sprint 7 lines are dated 20 Nov 2026 and were written from local builds served under `/<repo>/`. WebLLM appears only as not yet (cut from Sprint 4). Nothing says the manifest spec is live on
  GitHub: the spec wording is "manifest spec v0.1 published in runtime/spec (committed; public after the
  owner's push)". The home page repository table has the same limit for the runtime and localdata rows.
- No scripts at all, by design; nothing on the site is interactive.
- Most benchmark cells read `not measured`; only rows with a named command and saved evidence carry a
  figure, all of them Apple-silicon placeholders. The two localdata flat-index rows read `not measured`
  until localdata's benchmark CSV exists and the importer has been run. The paper tracker has no read
  papers yet.
- The DevTools slots show WebAssembly only (WebGPU was forced off in both runs), the page JS heap only
  (the worker heap and WebAssembly memory were not exposed), and two runs that differ after session create
  without an explanation.
- The Sprint 1 write-up quotes Apple-silicon figures only, labelled as placeholders; its
  fix-round paragraph is updated from the retest report once that report exists.
- The Sprint 2 write-up (`writeups/2026-11-sprint-2.html`) is finished from saved evidence and
  carries a dated correction (14 Nov 2026): WebLLM moved to Sprint 4 and was then cut (TD-08, not yet),
  and its score-versus-noise table is the Sprint 2 one (the CSV was regenerated in Sprint 3).
- The licensing page is a draft: nothing on it is policy until the owner approves it and links it.
  The team settled marks only where a LICENSE, CONTRIBUTING or spec file already says so (cited above);
  `CLA or DCO [owner to confirm]` and `Trademark and name use. [owner to confirm]` remain, and the
  banner carries one more.
- The Sprint 3 write-up is finished from `evidence/sprint-3/` only but is unlisted and `noindex` until
  the owner approves it; as of 14 Nov 2026, before the owner's push on 15 Nov, it says it is committed, not pushed. The Sprint 4 write-up is a
  skeleton, every section marked `[product owner to finish at close-out]`.
- Four of the Sprint 4 papers (the Update Framework paper, Sigstore, reciprocal rank fusion and
  local-first software) have a claim written from the title, because no abstract was fetched; their notes
  say so. The other claims were written from the fetched abstract.
- The CSP is delivered by a meta tag; GitHub Pages cannot set response headers, so
  `frame-ancestors` and the cross-origin isolation headers are not set.
- Two paper entries (Howe 2011, LLM as Runtime Error Handler) are `citation to verify`: their
  sources could not be confirmed during the sprint run.
- The tests read runtime's LANDED.json from `LANDED_JSON`, or merge the workspace
  `evidence/sprint-<n>/D1/LANDED.json` files in sprint order (a later sprint's entry replaces an earlier
  one); a clone with none of those skips the worker and Trusted Types cross-checks rather than guessing,
  and a clone without the glyphsift sibling skips the CSV cross-check. The write-up and licensing tests
  read the sibling `evidence/` and repository files and skip, never guess, when they are absent.

## Security and privacy

No analytics by design. The site runs no JavaScript, sets no cookies, loads nothing from a
third party and sends no telemetry. Each page carries
`Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none';
form-action 'none'` and `referrer: no-referrer`. The build refuses to emit a page that breaks
these rules. See SECURITY.md for the disclosure policy.

## Develop

**Tests read fixtures, not sibling repositories.** CI checks out this repository only, so `node --test` never touches `../<repo>` or `../evidence`. The
files the tests compare against (licence heads and cited licence lines, two benchmark CSVs, saved evidence figures and logs, the lanes' status lines,
dockit's two end-to-end CSVs) are committed under `test/fixtures/siblings/<repo>/<path>`, each recorded in `test/fixtures/siblings/SOURCE.json` with the
commit it was cut from (or, for the evidence folder, which is not a repository, the sha256 of the source file) and how it was cut: a whole file, or the
lines of a file that a test needs, never over 100 KB. A missing fixture is a failure, never a skip; a guard test fails if `test/build.test.mjs` reads
outside the repository. `node scripts/make-sibling-fixtures.mjs` re-cuts them from a workspace that has the siblings.

`npm run test:siblings` (local only, not run by `ci.yml` or `pages.yml`) needs the sibling clones and `evidence/` next to this repository. It runs the
whole suite again with `SITE_SIBLINGS=live`, so each check is made against the live sibling file, and it re-derives every fixture from its recorded source
and fails if one is stale. `node --test` finds `test/siblings.local.test.mjs` too and reports it as a pass that does nothing: the file starts its tests
only with `--live`.

`node scripts/sync-demo-status.mjs [--check] [--from <dir>]` rewrites the six lines of `data/demos.json` from the lanes' `status-line.txt` files
(`evidence/sprint-<SPRINT>` by default, where `SPRINT` is the one constant in `scripts/sibling-fixtures.mjs`, falling back to the lane scratch folder of that sprint until the architect has copied it; or
`--from <dir>`); the lines are never typed here, and each `writtenOn` is the date inside its line (TD-78).

```sh
node scripts/build.mjs          # build to dist/
node scripts/build.mjs /tmp/out # build elsewhere
node --test                     # run test/build.test.mjs
```

CI runs the same two commands on Linux, macOS and Windows; the Pages workflow builds, tests and
deploys `dist/` from `main`. For the Sprint 4 work: pushed 15 Nov 2026 at 4bd3cb2; CI and pages at that head red: runs 43667716669 and 43667716681; the live site still shows Sprint 2; open until the owner pushes the Sprint 5 fix and reads green runs.

## Licence

Code (scripts, tests, templates, stylesheet, workflows): Apache-2.0, see LICENSE and NOTICE.
Prose and data (`writeups/`, `data/`, page text): CC BY 4.0, see LICENSE-CC-BY-4.0.
