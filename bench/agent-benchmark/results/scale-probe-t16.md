# T16 scale probe — is the "agent miscounts structure" thesis real?

Direction (B) tested whether the codegraph-free agent miscounts a codebase's structure
WORSE at scale. It does not — and re-examining the v2 result exposed a scope artifact.

## rich (Textualize/rich, 100-file package — 2.7x requests)

Independent `ast` ground truth: 100 modules, 181 classes, 161 functions, 751 methods.
codegraph:                       100 modules, 173 classes, 139 functions, 729 methods (+60 override edges).
Baseline agent (file tools only, 3 turns, 17s): **100 / 181 / 161 / 751 — EXACT.**

The agent wrote an AST script and nailed it. No miscount at 2.7x scale. Thesis refuted for counting.

## requests re-examination — the v2 "2x miscount" was a SCOPE artifact

Independent `ast`:
- WHOLE repo (37 .py, incl tests — what codegraph scanned): 37 / 96 / 187 / 524
- src/requests PACKAGE (19 .py — what the agent counted):    19 / 52 / 91 / 177

v2 baseline agent answered: 19 / 52 / 91 / 177  → EXACTLY the source-package ground truth.
codegraph reported:         37 / 72 / 173 / 475 → the whole-repo scan (source + tests).

The agent counted the library SOURCE correctly; codegraph counted source + tests. Different
denominators, graded as "wrong". The "agent saw half the code" claim does not survive.

## Honest conclusion

- Counting structure is NOT codegraph's advantage: a capable agent script-counts it accurately.
- codegraph's durable, demonstrable edge is RELATIONAL certainty — a resolved cross-file graph
  for queries grep/extrapolation can't cheaply answer: virtual-dispatch paths (find_path, T15,
  found:false -> found:true), callers, blast radius, dependency closure — precomputed and certain.
- On a small-to-medium repo the agent-MCP efficiency is ~neutral; the value is certainty, the
  human dashboard, and (plausibly, still undemonstrated) much larger scale than 100 files.
