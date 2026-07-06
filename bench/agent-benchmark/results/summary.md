# codegraph agent benchmark — results (v2, fair A/B)

Repo: `requests` · model: `sonnet` · 6 tasks × 2 conditions (real `claude -p` runs).
Baseline runs on a **codegraph-free** copy (file tools only); codegraph runs on an indexed copy with the MCP. Lower is better for turns/context/time/cost.

## Per-task

| Task | Turns b→cg | Context tok b→cg | Duration b→cg | Correct b/cg |
|---|---|---|---|---|
| callers | 3→6 (+100%) | 141130→314411 (+123%) | 16s→30s | ✓/✓ |
| auth-subclasses | 3→4 (+33%) | 138790→205803 (+48%) | 11s→23s | ✓/✓ |
| call-path | 7→10 (+43%) | 370113→462589 (+25%) | 38s→49s | ✓/✓ |
| graph-stats | 6→4 (−33%) | 322020→200435 (−38%) | 54s→25s | ✗/✓ |
| dependencies | 3→3 (−0%) | 138845→143404 (+3%) | 11s→9s | ✓/✓ |
| api-surface | 4→3 (−25%) | 191153→142261 (−26%) | 14s→13s | ✓/✓ |

## Aggregate (sum across 6 tasks)

| Metric | Baseline | codegraph | Δ |
|---|---|---|---|
| Turns | 26 | 30 | +15% |
| Context tokens | 1302051 | 1468903 | +13% |
| Output tokens | 6727 | 7393 | +10% |
| Duration (s) | 144 | 149 | +3% |
| Cost (USD) | 1.512 | 1.835 | +21% |
| Correct | 5/6 | 6/6 | — |
