# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Sprint 5 (18 Nov 2026, committed, not pushed): the public benchmark page carries the dockit end-to-end section, built only from `data/e2e.json` (written by
  `scripts/import-dockit-bench.mjs` from dockit's two CSVs, with `--check`): time to first token, total, peak memory as the Chrome process tree, the JS heap and
  WebAssembly memory under their own names, storage, requests after offline, the question-set result as N of M, the done-when line, the limitations and an
  8 GB column that reads not measured on 8 GB. (D5-02)
- `test/fixtures/siblings/` with `SOURCE.json`, `scripts/sibling-fixtures.mjs` and `scripts/make-sibling-fixtures.mjs`: every check that read a sibling repository
  or the workspace evidence folder reads a committed fixture, so `node scripts/build.mjs && node --test` passes in a lone checkout (no test skipped for a missing
  sibling; a guard test and a fixture-integrity test). `npm run test:siblings` (local only) re-runs the suite against the live siblings and re-derives each fixture. (D5-01)
- `scripts/sync-demo-status.mjs`: the six demo lines of `data/demos.json` come from the lanes' `status-line.txt` files. (D5-09)
- Fix round 1 (18 Nov 2026): the benchmarks page and `scripts/import-dockit-bench.mjs` take the `laptop_8gb` column of dockit's two CSVs (every row must read
  `not measured on 8 GB`; the importer refuses anything else) and show it in the run table and in the question table. (D5-FIX1-06)
- A test greps every committed file for a home directory or a scratch path; `cut.redact: "paths"` in `SOURCE.json` and `scripts/sibling-fixtures.mjs` rewrite them in the
  fixtures that held them (`<workspace>`, `<projects>`, `<scratch>/sprint-N`, `<home>`). (D5-FIX1-13)

### Changed

- The six lines of `data/demos.json` and the home page repository rows show Sprint 5 (written on 18 Nov 2026). (D5-09)

### Fixed

- The footer build id follows the other demos: `Built from main at <sha12>` in CI, `Local build <sha12>[-dirty]` from git HEAD locally, and `Local build unknown` for a lone
  checkout with no `.git` (or a copy inside another repository). It used to read `build local` everywhere outside CI. (D5-FIX1-03)
- README: section 1 carries the site line of `data/demos.json` verbatim (a test compares them), and the Sprint 4 state reads as it is: pushed 15 Nov at `4bd3cb2`, `ci` and
  `pages` red, the live site still Sprint 2, open until the owner pushes the Sprint 5 fix and reads green runs. (D5-FIX1-04, D5-FIX1-15)
- The benchmarks page says what "requests after offline" counts: application requests from the page, its workers and its service worker, not the browser's own `sw.js` check
  and favicon fetch. (D5-FIX1-07)
- Site `ci` and `pages` runs 43667716669 and 43667716681 (all three operating systems): test 47 (licensing citations) and test 58 (the localdata CSV importer) read
  `../localdata` and the cited sibling files. The tests now read committed fixtures. The CI leg that proves it is `check` on ubuntu, macos and windows, and `pages`.
  BUG-T1-S4-R2-01 and -02 were confirmed fixed at `4bd3cb2` and their tests kept. (D5-01)

- Fix round 2 (18 Nov 2026): the footer build id says `Built from main at <sha12>` only when `GITHUB_SHA` is 40-hex AND `GITHUB_REF` is `refs/heads/main` (or unset), the same
  rule as runtime's `demo/build-id.ts`; a run of `pages.yml` on another ref reads `Local build <sha12>[-dirty]` or `Local build unknown`. (BUG-T1-S5-R2-04, D5-FIX2-03)
- The question table and the importer keep two page columns apart (TD-59): `Cited source page correct` (a cited source names the page; a refused answer cites nothing, so it is
  never counted) and `Top-ranked retrieved passage on the right page` (retrieval quality, from dockit's new `top_retrieved_page_ok` column). The headline N of M keeps its
  definition. A file where the two columns disagree about which rows have a page is refused. (BUG-T1-S5-R2-05, D5-FIX2-04)
- README and CHANGELOG: the Sprint 4 history that was accurate on 14 Nov is dated "As of 14 Nov 2026, before the owner's push on 15 Nov", so no current-looking sentence says Sprint 4
  is unpushed. (T3-R1-05, D5-FIX2-05)

### Earlier entries

- As of 14 Nov 2026, before the owner's push on 15 Nov: Sprint 4 (14 Nov 2026, committed, not pushed): 35 papers added to the tracker from `research/plan-validation-2026-11-14.md`
  section 3, each tagged with the repo it informs and each checked against its primary page (arxiv.org,
  doi.org, the USENIX or NeurIPS proceedings page) on 14 Nov 2026; all `to-read`. FineWeb2 is recorded under
  the ID its own page confirms (the research list gave a different paper's ID). Standards and items that
  could not be confirmed are not added. Tests first: the total is 30 plus the pinned new ids, no duplicate
  id, URL or normalised title, https URLs, a `citation verified 2026-11-14 against ...` note, and every
  external link carries `rel="noopener noreferrer"`. (D5-02)
- `scripts/import-localdata-bench.mjs`: writes two `data/benchmarks.json` rows (100,000 x 384 with 256-byte and
  2,048-byte synthetic chunks, OPFS, cold open plus first query, median and worst of the cold runs) from
  `../localdata/docs/benchmarks/vector-index.csv`, citing the CSV path, the commit column as written and
  `npm run bench:vectors`; with no CSV the rows read `not measured`; a row whose `match` is not true is refused.
  Tests use `test/fixtures/vector-index.csv`. (D5-05)
- As of 14 Nov 2026, before the owner's push on 15 Nov: Sprint 3 write-up finished from `evidence/sprint-3/` only (each figure next to its evidence path, checked by a
  test against the saved files; says it is committed on 14 Nov 2026, not pushed); Sprint 4 write-up skeleton
  with five sections marked for the product owner. Both unlisted, `noindex` and unlinked. (D5-04)
- Tests: licensing marks and sources, the demos lines, the WebLLM and spec wording, and a sweep that no page,
  write-up or data file makes an inference-cost pitch (phrase list in `test/build.test.mjs`, TD-11).
  (D5-03, D5-06)

- Sprint 3 fix round: tests that pin the glyphsift score-versus-noise row to a fresh computation over the
  sibling `docs/score-vs-noise.csv`, the demos.json lines to T1's observations (runtime, glyphsift, the
  build-id wording), the licensing promise sentence, the README owner step and section order, and the
  dated Sprint 2 correction. LANDED.json is read from `LANDED_JSON`, the workspace evidence copy or the
  scratch copy, and the worker and Trusted Types cross-checks are skipped when none is reachable.
  (BUG-T1-S3-02, BUG-T1-S3-03, BUG-T1-S3-06, T3-S3-005, T3-S3-006, T3-S3-015)

- Draft support in the build: `<meta name="draft" content="true" />` emits a robots noindex meta
  and keeps the page out of the write-ups list. (D5-05)
- `/licensing/`: licensing policy draft for owner review, unlinked and `noindex`, table from the new
  `data/licences.json` (seven repos, equal to the sibling LICENSE files), the plan's literal
  promises only, all else `[owner to confirm]`. (D5-05)
- Sprint 3 write-up skeleton `writeups/2026-11-sprint-3.html` (draft, no figures) and two
  benchmark slots for model-load timing per phase and memory at load, both "not measured". (D5-06)

- Build id in every page footer (`Built <date> · build <id>`): first 12 characters of
  `GITHUB_SHA` only when it is 40-hex, else `local`; node tests cover unset, malformed and valid
  values. (T1-S2-05)

- Sprint 2 write-up skeleton `writeups/2026-11-sprint-2.html`: honest-claim done-when and model
  wording verbatim, every result slot empty; test asserts no stray figures. (D5-04)
- Two benchmark slots, both "not measured": glyphsift score versus noise and runtime same prompt
  on WebGPU versus WASM (SmolLM2-135M q4), each with its reproduce command. (D5-05)
- Test that every `demos.json` status carries a Sprint 2 date, and that no built page has a
  script tag. (D5-05)

### Changed

- `/licensing/` (still a `noindex`, unlinked draft): the marks on the pagetriage dual licence, what the core
  covers, the open specs and the control-plane licence are settled only where a LICENSE, CONTRIBUTING or spec
  file states the text verbatim, each with a `<!-- source: path:line | fragment -->` comment and a row in the
  README; the pricing sentence lost its mark and gained no price or term. `CLA or DCO [owner to confirm]` and
  `Trademark and name use. [owner to confirm]` remain. TD-06 (amended) and TD-24, team decisions under
  owner delegation. (D5-03)
- Model-load timing and memory benchmark rows filled from the saved DevTools-panel output of two headed runs
  (`RUNTIME_MODEL=1 npm run test:devtools`), labelled Apple silicon, WebAssembly only. (D5-05)
- `data/demos.json`: the dockit and site lines are Sprint 4 lines (14 Nov 2026); WebLLM reads "cut from
  Sprint 4"; the spec wording is "manifest spec v0.1 published in runtime/spec (committed; public after the
  owner's push)". The home page runtime row says "WebLLM: not yet (cut from Sprint 4)". External links carry
  `rel="noopener noreferrer"`. The tests read LANDED.json from `LANDED_JSON` or the merged
  `evidence/sprint-<n>/D1/LANDED.json` files, and no scratch path. (D5-06)

- `data/demos.json`: six lines dated Sprint 3 (14 Nov 2026), now matched to T1's observations and
  LANDED.json. runtime: engine picker, the engine runs in a worker, the page stays responsive during a
  WebAssembly answer, a load-timing and memory read-out, the DevTools panel loadable unpacked, Trusted
  Types on; the freeze and Force WASM statements are gone; WebLLM (carried to Sprint 4), the 8 GB laptop
  and the Stop button are not yet. glyphsift: paste, drop or choose a UTF-8 .txt up to 1 MiB, per-line
  strip, per-cluster heatmap, refusals, 0 requests; the stale "per-line heatmap" not-yet is removed.
  pagetriage, localdata and dockit: "the page shows the build id" instead of "the status line"; dockit
  adds Trusted Types and the worker note. (D5-06, BUG-T1-S3-02, BUG-T1-S3-03, BUG-T1-S3-06, T3-S3-005)
- `data/benchmarks.json`, glyphsift score-versus-noise row: the mixed-family means are recomputed by
  script from the regenerated `glyphsift/docs/score-vs-noise.csv` (998,476; 996,985; 991,696; 983,977;
  967,538; 933,440; the Sprint 2 figures were 998,454 to 932,405) and the evidence is
  `evidence/sprint-3/D3/bench-s3.log and docs/score-vs-noise.csv`. (T3-S3-006)
- Licensing draft: the promise sentence names pagetriage's `MIT OR Apache-2.0` dual licence instead of
  claiming Apache-2.0 for every library, and says what is beyond the plan text with `[owner to
  confirm]`; what "the core" covers is added to the undecided list. (T3-S3-015)
- Sprint 2 write-up: a dated correction (14 November 2026) that WebLLM moved to Sprint 4 and that its
  score-versus-noise table is the Sprint 2 one; the original text is left in place. (T3-S3-015)
- README: Install carries an explicit "Not a registry package" note (the site is an application on
  GitHub Pages); sections follow the conventions order (Demo and Licensing draft after Contracts);
  Status, Benchmarks and Limitations updated; the owner step now covers the `#draft-banner`, the
  "(draft)" title and the nav link. (T3-S3-015)

- The Sprint 2 write-up is finished from saved evidence (score versus noise, WebGPU and WebAssembly legs,
  what did not pass); three benchmark rows carry Apple-silicon placeholder figures with an `evidence` field
  rendered in the notes column, and the laptop column stays "not measured". The tests now allow a figure
  only with its evidence (write-up: an explicit list of figures copied from evidence). The pagetriage and
  site demo status lines say Windows CI passes and the write-up is finished.
- Added `.npmrc` with the five standard lines for consistency; site still has zero dependencies. (T3-S2-R1-04)

- `demos.json` status lines rewritten to match T1's observations; Sprint 2 write-up uses the
  exact Hindi smoke-run sentence instead of the conditional wording. (T1-S2-03, T1-S2-04)

- All six `demos.json` status lines rewritten with a Sprint 2 date; keys and URLs unchanged. The
  demos page derives its "written on" date from the data instead of hard-coding it. (D5-05)

- Zero-dependency static site builder (`scripts/build.mjs`, Node 22): layout template,
  pages, paper tracker rendered from `data/papers.json`, benchmarks scaffold rendered from
  `data/benchmarks.json`, write-ups folder, `.nojekyll`.
- Paper tracker seeded with the first 30 papers named or implied in the plans. Citations
  carry a `url` or `venue` only where the source was fetched during the sprint run; every
  other entry is `to-read` with the note `citation to verify`.
- Benchmarks page scaffold with the 8 GB Windows laptop columns; every cell reads
  `not measured` until a named command produces a figure.
- `node --test` suite that builds into a temporary directory and checks the paper count,
  the absence of scripts and third-party assets, the CSP meta and the data invariants.
- Sprint 1 write-up (`writeups/2026-11-sprint-1.html`), written only from the tester reports:
  what shipped, the 700 MB download, resume and corrupt-hash proofs with every figure labelled
  as an Apple-silicon placeholder, what failed in round one, and why pagetriage v1.0.0 was not
  tagged.
- GitHub Pages workflow with per-job permissions (`pages: write`, `id-token: write` on the
  deploy job only) and a three-OS CI workflow.
- Demos page (`/demos/`) rendered from `data/demos.json`: the six public GitHub Pages demos
  (pagetriage, runtime, glyphsift, localdata, dockit, site) with a one-line status each and a
  column headed "Status written on"; the lede says the statuses were written on 9 Nov 2026 from
  local builds and not measured at the live URLs; a "What this demo does not do yet" box closes
  the page. A Demos section with the same six links sits on the home page before Repositories,
  and the nav gains a Demos link. The build refuses a demos list that is not exactly those six
  entries with matching URLs; five tests cover the data, both pages and the nav.
- `persist-credentials: false` on the `actions/checkout` step of both workflows.

### Fixed

- `data/demos.json` localdata line now states the Sprint 3 capability the refreshed demo shows (storage.set, storage.get, storage.delete and storage.quota events listed live through an optional sink, never keys or values; not yet in the DevTools panel). (T3-S3-029)

- `demos.json` site status now says "three unmeasured Sprint 2 slots (two done-when rows and glyphsift throughput)", matching the benchmarks page. (T1-R1-01)
- Write-up loaded-once sentence now ends with the evidence citation, as in runtime/README.md. (T3-S2-R1-02)

### Security

- The build refuses to emit any page containing `<script`, any `<link>`, `<script>` or
  `@import` that references a host other than github.com, arxiv.org or doi.org, or any
  inline `style=` attribute. Every page carries a CSP meta that allows only same-origin
  styles and images.
