# Contributing to the Airplane Mode Labs site

## Ground rules

- Zero dependencies. The build is `node scripts/build.mjs`; nothing is installed. A pull
  request that adds a package needs a very good reason and a CHANGELOG entry.
- No scripts, no analytics, no third-party resources on any page. The build refuses to emit
  a page that contains `<script`, loads a stylesheet or script from another host, or carries
  an inline `style=` attribute.
- Tests first: `test/build.test.mjs` pins what the build must produce; extend it before
  changing the build.
- Papers: follow the citation rule in README.md. A `url` or `venue` is written only after the
  source (arxiv.org, doi.org, a proceedings page or the standard's page) was fetched and the fetch logged; until
  then the entry is `to-read` with the note `citation to verify`.
- Write-ups quote numbers with the command that produced them, or do not quote numbers.
- British spelling, no emojis.

## Licences

Code contributions are licensed under Apache-2.0 (LICENSE). Prose and data contributions
(writeups/, data/, page text) are licensed under CC BY 4.0 (LICENSE-CC-BY-4.0). By
contributing you agree to these terms.

## Issues

Use one of the forms under `.github/ISSUE_TEMPLATE/`. Never attach a real, confidential or personal document (bank, legal, medical, identity) to an issue or a pull request: a sample
is synthetic or public, and anything you paste is redacted first. A vulnerability is reported privately, as `SECURITY.md` says, never in a public issue.
