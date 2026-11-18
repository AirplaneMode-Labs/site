# Test fixtures

`vector-index.csv` holds synthetic rows for the importer tests (`scripts/import-localdata-bench.mjs`).
Nothing in it was measured: the timings, heap and byte figures are invented to exercise the importer,
and the machine column reads `synthetic fixture` for that reason. Do not quote any figure from it.
Its header equals the real localdata benchmark header; the real measurements live in
`localdata/docs/benchmarks/vector-index.csv`.

`e2e.csv` and `e2e-questions.csv` are synthetic as well: they have the columns of dockit's `docs/benchmarks/e2e.csv` and
`e2e-questions.csv` (the last one, `laptop_8gb`, reads `not measured on 8 GB` on every row and the importer refuses anything else) and exist only to exercise `scripts/import-dockit-bench.mjs`. The machine column reads `synthetic fixture`;
none of the figures was measured. Do not quote them. The real rows live in `dockit/docs/benchmarks/` and, as committed copies for CI,
in `test/fixtures/siblings/dockit/docs/benchmarks/`.

`siblings/` holds the files the CI tests check against other repositories and the workspace evidence folder (see `SOURCE.json`).
A fixture whose source holds the owner's home directory or a sprint's scratch folder is cut with `redact: "paths"`: after the cut
those paths read `<workspace>`, `<projects>`, `<scratch>/sprint-N` and `<home>`, and nothing else changes, so the values a test asserts stay
as they were. A test greps every committed file of this repository for a home or scratch path and fails on any hit.
