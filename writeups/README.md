# Write-ups

Short notes on what we built, what a paper claimed and what held up. Licensed under
CC BY 4.0 (see ../LICENSE-CC-BY-4.0); attribute "Airplane Mode Labs" with a link to the
page.

## Format

One HTML fragment per write-up, named `YYYY-MM-<slug>.html`, in this folder. The build wraps
it in the site layout and publishes it at `/writeups/YYYY-MM-<slug>/`. The fragment starts
with two comment lines the build reads:

```html
<!-- title: Sprint 1: a 700 MB asset that survives a refresh -->
<!-- date: 2026-11-22 -->
<h1>Sprint 1: a 700 MB asset that survives a refresh</h1>
<p>...</p>
```

Rules the build enforces: no `<script`, no stylesheet or script from another host, no inline
`style=` attributes. Rules we enforce by review:

- Every number is quoted with the command that produced it and the machine it ran on. A
  figure from an Apple-silicon development machine is labelled as a placeholder until the
  8 GB Windows no-GPU laptop has been measured.
- Negative results are written up with the same care as positive ones.
- Each paper reimplemented gets: what the paper claims, what held up, what did not.

The first write-up, `2026-11-sprint-1.html`, is written from the Sprint 1 tester reports
(T1 browser proofs, T2 Rust and interop gates, T3 release gate, S1 security review) and from
nothing else; a write-up is never written from the plan. If a retest changes a number, the
write-up is updated from the retest report.
