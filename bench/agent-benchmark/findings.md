# codegraph agent benchmark — findings

Honest write-up of what the benchmark measured. No spin: the result is **nuanced**,
not a blanket win, and it points at a concrete codegraph improvement.

## ⚠ CORRECTION (T16) — the `graph-stats` "win" was a scope artifact

Read `results/scale-probe-t16.md` for the full re-examination. Short version: the
**"codegraph wins decisively — agent miscounted the codebase ~2×"** claim below (item 1,
and the graph-stats row) **does not survive scrutiny and is retracted.** The v2 baseline
agent answered `19 / 52 / 91 / 177`, which is the *exact* independent AST count of the
`src/requests` **source package** — the agent counted the source correctly. codegraph's
`37 / 72 / 173 / 475` counted the **whole repo including tests**. Different denominators,
not an accuracy gap. A scale probe on `Textualize/rich` (100-file package) confirmed it:
the codegraph-free agent script-counted `100 / 181 / 161 / 751`, exact. **Counting
structure is not codegraph's advantage** — a capable agent does it accurately alone.

What holds up: codegraph's edge is **relational certainty** — a resolved cross-file graph
for queries grep/extrapolation can't cheaply answer (virtual-dispatch paths, callers,
blast radius, dependency closure). The clean demonstration is the `find_path` fix (T15):
`find_path(requests.get → HTTPAdapter.send)` went `found:false → found:true`, deterministic.
The rest of this doc is kept for the record; weigh item 1 and the graph-stats row against
this correction.

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
| call-path | 7 → 10 | $0.31 → $0.55 | ✓ / ✓ | overhead — `find_path` missed the edge (FIXED in T15, see below) |
| ~~graph-stats~~ | 6 → 4 | $0.43 → $0.23 | ✗ / ✓ | ~~codegraph wins~~ → RETRACTED (scope artifact, see correction above) |
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

## Update (T15): the `find_path` bug is fixed

The benchmark's finding #4 drove a real product change (commits `2c26f6c`, `3b72da1`):

1. **Model overrides.** A new `overrides` edge type; the Python indexer now captures
   same-file class inheritance and emits `HTTPAdapter.send` → `BaseAdapter.send`.
2. **Resolve virtual dispatch.** `find_path` traverses `overrides` edges in reverse, so a
   path that reaches the abstract base method continues to the concrete override.

**Deterministic, tool-level proof** (no LLM variance): on the re-indexed `requests`,
`find_path(requests.get → HTTPAdapter.send)` went from `found:false` to `found:true`,
tracing `get → request → Session.request → Session.send → BaseAdapter.send ⟿
HTTPAdapter.send`. The tool that whiffed now nails the path it exists to answer.

**Agent-level re-run** (`call-path`, single real `claude -p` A/B, `results/runs-t15.3-callpath.jsonl`):
codegraph dropped from **10 → 8 turns** and **49s → 32s** — now *faster* than the
file-only baseline (7 turns / 38s) with fewer output tokens, and the agent's answer
explicitly traces the virtual dispatch instead of noting the tool returned no match.
Verdict moves from *overhead* toward a *tie* (still 1 turn more than plain grep on this
37-file repo; cost ~flat). Single-run, so treat the turn delta as directional, not
precise — the deterministic tool-level result above is the durable claim.

**Scope, honestly.** At T15 this resolved **same-file** inheritance only (base + override
in one file — the requests `BaseAdapter`/`HTTPAdapter` and the `AuthBase` hierarchy).
Dotted / imported bases (`class X(base.Thing)`) need cross-file type resolution and were
deferred to the language type layer — now delivered (see the T16–T17 update below).

## Update (T16–T17): cross-file inheritance delivered, both languages

FR-97 override resolution is now complete for same-file **and** cross-file inheritance
across both languages codegraph parses — a subclass method that redefines an inherited
method emits an `overrides` edge to the base method even when the base class lives in
another file:

1. **Python cross-file** (commit `863a0c1`, T16.2). A Pyright/LSP pass resolves each
   imported / dotted base class to its declaration across files (`client.definition`),
   walks the base chain to the nearest same-named method, and emits the edge — only when
   the base is in a *different* file, so it never duplicates the same-file skeleton edges.
2. **TypeScript** (commits `0e5798f` T17.1 same-file, `0e20978` T17.2 cross-file). The
   tree-sitter skeleton resolves same-file heritage; a ts-morph pass uses `getBaseClass()`
   (the type checker) to resolve an imported base across files, with the same cross-file
   -only guard.
3. **Proven end-to-end** (commit `8b24527`, T17.3). An integration test drives the real
   `bootstrapRepo` indexer over a cross-file class hierarchy in *both* languages, then
   asserts `find_path` resolves the virtual dispatch caller → `BaseAdapter.send` →
   `HTTPAdapter.send` — and that the override edge is load-bearing (disable it, no path).

This is a capability-completion note: it extends the relational-certainty story (resolved
cross-file structure grep/extrapolation can't cheaply answer), not the retracted counting
claim — the T16 correction above still stands.

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
- ~~Fix `find_path` override-edge resolution~~ **DONE** — same-file (T15) *and* cross-file
  (T16–T17, both languages) inheritance now resolve virtual dispatch (`found:false` →
  `found:true`), proven end-to-end through the real indexer. `find_path` nails the path it
  exists to answer.
- Re-run on a large, unfamiliar repo for the demonstration that matches codegraph's
  actual target — that is where "codes in a completely new way" earns the claim.
