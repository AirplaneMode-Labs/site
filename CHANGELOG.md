# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

### Security

- The build refuses to emit any page containing `<script`, any `<link>`, `<script>` or
  `@import` that references a host other than github.com, arxiv.org or doi.org, or any
  inline `style=` attribute. Every page carries a CSP meta that allows only same-origin
  styles and images.

### Fixed

- `demos.json` site status now says "three unmeasured Sprint 2 slots (two done-when rows and glyphsift throughput)", matching the benchmarks page. (T1-R1-01)
- Write-up loaded-once sentence now ends with the evidence citation, as in runtime/README.md. (T3-S2-R1-02)
