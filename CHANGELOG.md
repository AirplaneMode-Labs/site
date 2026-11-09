# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
