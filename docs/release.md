# Release

The site is never published to a registry; the Pages deploy is the release.

It is a private application (`@airplanemode/site`, `private: true`) of plain HTML, with no dependency: there is no npm package, wheel or crate, so there is nothing to reserve, sign or publish.
The release is the GitHub Pages deploy of `.github/workflows/pages.yml` at https://airplanemode-labs.github.io/site/, built from `main`. The site is not tagged, and nothing is published by the team: the push
is the main session's (owner decision of 19 Nov 2026), and a tag is the owner's.

Definition of done for a release, as it stands for the site:

| Row | State |
|---|---|
| Tests first, CI on Linux, macOS and Windows | Done: `node scripts/build.mjs && node --test` on the three systems, from a lone checkout (fixtures stand in for the sibling repositories). |
| Benchmark on an 8 GB laptop in the README | **Open, owner only**: the site only shows other repositories' figures, and every 8 GB cell reads "not measured on 8 GB". |
| Limitations section | Done (README). |
| Signed artefacts and manifest | Not applicable: the site ships no artefact; the Pages deploy is the release. |
| CHANGELOG | Done (`## [0.1.0-dev] - 2026-11-20 (untagged)`). |
| Semver tag | None, and none is created by the team. |
| Installable from a clean machine | Not applicable: nothing is installed; a lone checkout builds and passes its tests (`pages.yml` and `ci.yml` do exactly that). |
| Short write-up | The Sprint 6 write-up is finished as an unlisted draft; the Sprint 7 write-up is a skeleton. Nothing is published. |
