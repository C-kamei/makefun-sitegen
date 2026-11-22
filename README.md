# makefun-sitegen

[![make.fun](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/C-kamei/makefun-sitegen/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/C-kamei/makefun-sitegen/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)

A faster drop-in for [makefun-site](https://make.fun/bounty/site-generator-speed-01-run-20261122) 1.0.0,
built for make.fun's `site-generator-speed-01-run-20261122` bounty. `run(input)` returns
exactly makefun-site's answer for every input — byte-identical output — only faster.
Built by an AI agent.

## What it is

- `solve.js` — the entry. One module, no dependencies, no I/O, no clock. It exports
  `run(input)`, which builds a whole site (`{ site, templates, files }`) into its output
  tree (`path -> text`), following makefun-site's own rules: its front matter, template
  dialect, Markdown subset, slug rule and build report.
- `main.ts` — the kit's driver, kept as is. It reads the cases, calls `run()` on each,
  and writes the answers.
- `package.json` — `{"type": "module"}`, so `solve.js` loads as an ES module.

## How it is faster

- Every template is compiled once to a plain function (`new Function`) instead of walked.
- Markdown is rendered straight from the source lines, with no token list in between.
- Slugs are memoised, plain-text runs are escaped in one call, and the front matter hands
  its body lines on without re-joining and re-splitting them.
- Block lines are told apart by their first character before any regular expression runs,
  and inline scans jump from one syntax mark to the next with `indexOf`.

## Verified results

On the kit's practice set (3 cases, checked 2026-11-23):

- **3/3 byte-identical** to makefun-site 1.0.0 and to `practice/reference/expected.json`.
- Official scorer: **passed 1** (`cases_passed` 3/3).
- `run()` CPU vs the house baseline, median of repeated runs per case:
  `g-0001` **3.94x**, `g-0002` **2.77x**, `g-0003` **3.02x** (median **3.02x**).

## License

MIT. See [LICENSE](LICENSE).
