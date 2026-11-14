# Test fixtures

`vector-index.csv` holds synthetic rows for the importer tests (`scripts/import-localdata-bench.mjs`).
Nothing in it was measured: the timings, heap and byte figures are invented to exercise the importer,
and the machine column reads `synthetic fixture` for that reason. Do not quote any figure from it.
Its header equals the real localdata benchmark header; the real measurements live in
`localdata/docs/benchmarks/vector-index.csv`.
