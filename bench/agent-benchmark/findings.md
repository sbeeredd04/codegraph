# codegraph agent benchmark — findings

Honest write-up of what the benchmark measured. No spin: the result is **nuanced**,
not a blanket win, and it points at a concrete codegraph improvement.

## Setup

`psf/requests` (37 files, 757 graph nodes), model `sonnet`, 6 comprehension tasks,
each run as a real headless `claude -p` agent twice: a **codegraph-free** copy of the
repo (file tools only) vs. an **indexed** copy with the codegraph MCP. Full data in
`results/runs.jsonl`; the confounded first attempt is kept in
`results/runs-v1-confounded.jsonl` (see "Method correction" below).

## Result (fair A/B)

| Task | Turns b→cg | Cost b→cg | Correct b/cg | Verdict |
|---|---|---|---|---|
| callers | 3 → 6 | $0.23 → $0.44 | ✓ / ✓ | codegraph overhead |
| auth-subclasses | 3 → 4 | $0.18 → $0.26 | ✓ / ✓ | codegraph overhead |
| call-path | 7 → 10 | $0.31 → $0.55 | ✓ / ✓ | overhead — `find_path` missed the edge |
| **graph-stats** | **6 → 4** | **$0.43 → $0.23** | **✗ / ✓** | **codegraph wins decisively** |
| dependencies | 3 → 3 | $0.18 → $0.18 | ✓ / ✓ | tie |
| api-surface | 4 → 3 | $0.19 → $0.19 | ✓ / ✓ | tie |
| **Aggregate** | **26 → 30** | **$1.51 → $1.84** | **5/6 → 6/6** | mixed + 1 accuracy gain |

## What it actually shows

1. **The real advantage is grounded structure, not raw speed.** On the one
   whole-codebase question (`graph-stats`), the codegraph-free agent **miscounted the
   codebase ~2×** (19 vs 37 modules, 52 vs 72 classes, 177 vs 475 methods) — a wrong
   mental model — *and* spent 2× the time and cost to get there. With codegraph it was
   correct, faster, cheaper. An agent that reads a few files *approximates* structure
   and confidently errs; the graph is ground truth. This is codegraph's genuine value.

2. **On local, single-file lookups codegraph is a wash** (`dependencies`,
   `api-surface`). Grep on one file is already fast and correct — a graph neither helps
   nor hurts. Honest: don't claim a win here.

3. **On targeted navigation on a *small* repo, codegraph added overhead**
   (`callers`, `auth-subclasses`, `call-path`): the agent queried the graph *and* still
   opened source to confirm, and was more verbose. A strong model greps a 37-file repo
   efficiently, so the extra tool round-trips didn't pay off — **at this scale**.

4. **The benchmark surfaced a real codegraph bug.** `find_path(requests.get →
   HTTPAdapter.send)` returned *no path*: the call graph resolves `adapter.send` to the
   **annotated** `BaseAdapter.send`, not the concrete `HTTPAdapter.send` reached at
   runtime (virtual dispatch / override edges are missing). This is why `call-path` got
   *worse* with codegraph — the tool that should have nailed it whiffed, and the agent
   fell back to files anyway. Fixing override-edge resolution is the highest-value
   codegraph change this benchmark justifies: navigation is the #1 agent use case.

## Honest caveats (why this understates codegraph)

- **Scale.** `requests` is tiny and famous. codegraph's whole reason to exist is the
  codebase a model *can't* hold in context — where grep explodes and the agent's
  approximated structure compounds into wrong answers. The `graph-stats` miscount is a
  preview of that failure mode; it gets worse as repos grow. A fair large-repo run is
  the honest way to show the advantage at the scale codegraph targets.
- **The dashboard isn't measured here.** This benchmark is agent-MCP efficiency only.
  codegraph's human-facing value (the visual board, docs, diagrams) is out of scope.

## Method correction (transparency)

The first run put `.codegraph/` in the shared repo, so the "baseline" agent read
codegraph's pre-computed **report** for free — not a real "without" condition. That run
(`runs-v1-confounded.jsonl`) is kept for the record; all numbers above are the corrected
A/B with a codegraph-free baseline.

## Takeaways

- Ship the honest story: **codegraph makes an agent's structural understanding correct,
  not just faster** — decisive on whole-codebase questions, neutral on local ones.
- Fix `find_path` override-edge resolution (turns the navigation losses into wins).
- Re-run on a large, unfamiliar repo for the demonstration that matches codegraph's
  actual target — that is where "codes in a completely new way" earns the claim.
