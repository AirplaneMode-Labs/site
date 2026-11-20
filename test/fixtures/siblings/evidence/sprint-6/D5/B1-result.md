# B1 result (D5-04): memory hardening of the dockit pipeline, measured on this Mac

Written by D5 on 19 Nov 2026. Machine: Apple M5 Pro 48 GB, installed Chrome 157, headless, one Chrome session of five runs plus one run after a
Chrome restart. **Not measured on 8 GB.** Command for both sets: `npm run bench:e2e` in dockit (`DOCKIT_BENCH_CSV` and
`DOCKIT_BENCH_Q_CSV` set for the baseline only). Data: `dockit/docs/benchmarks/e2e-s6-baseline.csv` and `e2e-questions-s6-baseline.csv` (before),
`e2e.csv` and `e2e-questions.csv` (after).

## Verdict

**The TD-66 memory target was MISSED. The question-set floors and the time guard were reached. 0 requests after caching in every run of both sets.**
The architect and the product owner decide and record what happens to the measures (TD-88): the target is not moved after the numbers are seen.

| TD-66, stated before measuring (addendum of 19 Nov 2026, section 2) | Target | Before | After | Outcome |
|---|---|---|---|---|
| Chrome process-tree peak, median of 5 runs | at most 5,120 MiB | 6,307.5 MiB | **5,440.8 MiB** (worst 5,476.1 MiB) | **missed**: 320.8 MiB over the target; the cut is 866.7 MiB, 13.7 percent, against the 18.8 percent the target needed from this set's own same-day baseline of 6,307.48 MiB (the addendum's 18.5 percent is from the earlier 6,283 MiB baseline) |
| Fixed question set, all runs | at least 24 of 36 | 24 of 36 | 24 of 36 | reached, unchanged (q2 and q6 wrong in all 6 runs in both sets) |
| Fixed question set, first run | at least 4 of 6 | 4 of 6 | 4 of 6 | reached, unchanged |
| The unanswerable question (q7) | refused | refused 6 of 6 | refused 6 of 6 | reached |
| Top-ranked passage on the right page (M4's condition) | unchanged | 36 of 36 | 36 of 36 | unchanged, so M4 stays |
| Median per-question total answer time, all 42 question rows | at most 12,500 ms | 9,390.5 ms | **11,950 ms** (worst 13,281 ms) | reached, with 550 ms to spare; the worst single question is over the guard |
| Requests after offline | 0 | 0 in 6 of 6 | 0 in 6 of 6 | reached |

**Rounding and the meaning of 'median' (BUG-T1-S6-04).** Every difference and percentage in this file, the dockit README, the status line, the site benchmarks page and the Sprint 6 write-up is computed from the exact medians (bytes, then MiB) and rounded only when written, by `dockit/scripts/memory-figures.mjs`; a rounded median is a display value, so a difference can differ by 1 MiB from the subtraction of two rounded medians (here 866.7 MiB exact, 867 MiB rounded; the two rounded medians 6,307 and 5,441 subtract to 866). 'Median' is the median of the 5 in-session runs; the run after a Chrome restart is a separate row and is not in it (with all 6 rows the medians would be different). These figures are re-derived by the generators from the CSVs, with no typed number, and change when the architect's wrap-up re-measure replaces the CSVs.

## What the numbers say

- **Memory.** The peak fell by 866.7 MiB, but the model that is loaded during an answer still sets it. The worker WebAssembly memory peak (the most the workers
  held at once) fell from 2,573.8 MiB (answer model, embedder and analysis worker together) to 2,240.8 MiB (the answer model alone): the embedder's share is gone,
  the answer model's is not. With no model loaded the summed resident size of the Chrome tree is about 3,051 to 3,054 MiB (idle between uses, read in the S1-107 runs of the final `test:e2e`), against
  5,643 MiB (T1) and 6,195 MiB (Sprint 5 observation) idle with the models loaded in Sprint 5. The remaining 320.8 MiB cannot come from a smaller embedder batch
  on this three-page document; the levers left are the answer model's own memory (a smaller or 4-bit graph, which the addendum rules out for this sprint) and the
  allocator options, which D1 measured to have no effect (`runtime/docs/memory-options.md`: onnxruntime-web 1.31.1 already treats an unset option as false).
- **Time.** Each question now loads the embedder and then the answer model from the device: 2 loads, about 2.3 s in all (2,180 ms and 2,395 ms in the two Stop
  tests of the final `test:e2e`, which print them). First token for the first question: 8,092 ms median against 7,857 ms. Total for the first question: 11,982 ms against
  9,500 ms. The cost of one question is therefore about 2.6 s for 866.7 MiB.
- **Correctness.** Nothing changed: the same 24 of 36 rows are right and the same two questions are wrong (q2, q6) in both sets.

## Per measure

| Measure | Landed | Contribution measured? |
|---|---|---|
| M1 one engine at a time (model pool, per-question order embedder then generator, every load a first load) | yes, `src/model/model-pool.ts` | not alone: no M1-only ablation was run (optional). The unload of the embedder is what takes the WebAssembly peak from 2,573.8 to 2,240.8 MiB |
| M2 allocator options off | landed by D1 (`sessionMemoryOptions: green`) | none: D1 measured the same worker peak with and without the options |
| M3 analysis and pdf workers ended as soon as their stage ends, bytes by transfer and back with a sha256 check | yes | not separated; the analysis worker's WebAssembly memory is small next to the answer model's (the three refused bomb files peaked at 3 to 5 MiB in it), so it is not where the peak is |
| M4 embed batch 32 to 8 | yes, kept: the question set and `top_retrieved_page_ok` are unchanged | none visible: the document has 3 passages, so the batch size does not change any tensor here |
| M5 smaller context window | not adopted: D1's finding (`D1/kv-cache-finding.md`) is that the cache is not pre-allocated | n/a |
| M6 memory line from the verified manifest, plain refusal, out-of-memory refusal | yes | a usability guard: it prevents a load, it does not lower the peak of a device that passes |

## How the figures were taken

1. Baseline: dockit at its pushed head `840ec8b0eba4`, cloned clean into scratch, the four siblings at the commits of `deps.lock.json`, `assemble-deps --checkouts`
   (no `--allow-dirty`), `npm run build`, then `bench:e2e` (`D5/logs/baseline.log`, `baseline-summary.txt`). The baseline's median is 24.9 MiB above the committed
   Sprint 5 figure (6,282.6 MiB): the same build, the same machine, other lanes building at the same time (load average 2.17 before the build and 8.13 after the bench).
2. After: the real dockit working tree on the assembled siblings (runtime and pagetriage as their working trees stood on 19 Nov, localdata and glyphsift at their
   locked commits; `D5/logs/assemble-dev2.log`), `npm run build`, `npm run bench:e2e` with the default CSV paths (`D5/logs/after.log`, load average 3.54 before and 5.64
   after). The commit column reads `840ec8b0eba4-dirty` as expected.
3. A first after-run (median 5,399 MiB, also missed) was discarded: its WebAssembly column summed the peaks of 15 loads that were never alive together (18,331 MiB). The
   harness was fixed test-first (`test/wasm-memory-peak.test.ts`) and the run repeated. Both runs are kept in `D5/logs/` (`after-run1-wasm-sum-bug.log`, `e2e-after-run1-wasm-sum-bug.csv`).
4. The Sprint 5 method for the WebAssembly column still gives the baseline's figure: with no `model.unload` event the engines and the analysis worker are summed.
5. `D5/td66-observed.txt`: the architect's `td66-stamp.txt` was absent when the after-run started, so D5 recorded the sha256 and mtime of the addendum (19 Nov 2026 18:03 IST,
   which names 5,120 MiB) and of PLAN.md (17:47, before any TD-66 row) just before measuring. The architect re-runs `bench:e2e` at the wrap-up on the committed build and commits that CSV.

## Reproduce

```sh
cd dockit
node scripts/assemble-deps.mjs --siblings .. --allow-dirty      # or --checkouts <dir> at the locked commits
npm run build
npm run bench:e2e                                                # 5 runs plus the restart run; writes docs/benchmarks/e2e.csv and e2e-questions.csv
node scripts/bench-readme.mjs                                    # the README table, from both CSV pairs
```

**Host load (BUG-T1-S6-05).** Process-tree peaks are comparable only between runs on a quiet host. Tester runs of the same build gave, under a load average of 7 to 22, 5,104 and 5,119 MiB (both under the 5,120 MiB target), and on a quiet host 5,433 and 5,441 MiB (both over it). The stated figure is the quiet-host one: this set's 5,440.8 MiB median. From this change on `bench:e2e` writes the 1-minute load average at the start and end of every run (`host_load_1m_start`, `host_load_1m_end`, two trailing columns of `e2e.csv`); the committed baseline CSV predates them and is not rewritten. Evidence: T1/bench-r1, bench-r1b, bench-r1c in the lane scratch.
