# codegraph agent benchmark (T14.5)

**Question:** does an AI coding agent comprehend an unfamiliar codebase measurably
better — fewer steps, less context, faster, cheaper, at equal correctness — when it
has the **codegraph MCP** than when it navigates with plain file tools?

## Method

For each task we run a **real** headless Claude agent (`claude -p "<task>"
--output-format json`) twice against the same repo and model, and record the JSON
telemetry (turn count, token usage, wall-clock, cost):

- **baseline** — default file tools only (`Read` / `Grep` / `Glob` / `Bash`). How an
  agent explores code today.
- **codegraph** — the same tools **plus** the codegraph MCP server
  (`node dist/mcp-server.js <repo>` over stdio), exposing `query`, `find_path`,
  `neighborhood`, `dependencies`, `graph_stats`, `find_symbol`, `entry_points`, …

Both conditions get the **identical task prompt**. The only difference is whether the
codegraph tools are on the agent's toolbelt — the realistic scenario for a dev who
installed codegraph. The answer is graded against a **source-derived key** (keywords
that must appear), so grading is ground truth from the code, not from codegraph.

## Metrics

- **Turns** — agent iterations / tool round-trips (`num_turns`). codegraph should cut
  the grep→read→grep loop to a single structural query.
- **Work tokens** — `input_tokens + output_tokens`: the fresh context the model had to
  ingest to answer plus what it generated. Reading whole files (baseline) bloats this;
  a compact tool result (codegraph) does not. This is the context-economy headline.
- **Duration** — wall-clock `duration_ms`.
- **Cost** — `total_cost_usd`.
- **Correct** — did the answer contain the ground-truth facts.

## Tasks (all verifiable in the `psf/requests` source)

| id | asks | codegraph capability | ground truth |
|---|---|---|---|
| `callers` | who calls `HTTPAdapter.send` | reverse call edges (`neighborhood`) | `Session.send` |
| `auth-subclasses` | `AuthBase` subclasses | `find_nodes` / `neighborhood` | HTTPBasicAuth, HTTPProxyAuth, HTTPDigestAuth |
| `call-path` | path `requests.get` → `HTTPAdapter.send` | `find_path` | request → Session.request → Session.send → HTTPAdapter.send |
| `graph-stats` | count modules/classes/functions/methods | `graph_stats` | 37 / 72 / 173 / 475 (757 nodes) |
| `dependencies` | first-party imports of `sessions.py` | `dependencies` | adapters, auth, cookies, models, exceptions, utils, hooks, structures |
| `api-surface` | public verbs in `api.py` | `find_file` / `find_symbol` | get, post, put, delete, head, patch, options, request |

## Run

```bash
# 1. index the repo once so the MCP has a graph to serve
node dist/cli.js graph /path/to/requests

# 2. point the harness at the same repo (codegraph-mcp.json already targets it)
BENCH_REPO=/path/to/requests node bench/agent-benchmark/run.mjs
```

Outputs (in `results/`): `runs.jsonl` (one row per run, written live), `results.json`
(full data + aggregate), `summary.md` (the tables). `codegraph-mcp.json` is the MCP
config handed to the `codegraph` condition.

## Honesty notes

- Real agent runs, real token/cost telemetry — nothing simulated.
- Same prompt + model both conditions; grading keys come from the source, not codegraph.
- `graph-stats` is aggregate-query-favorable to codegraph by nature (that is the point —
  graphs answer "how much / how many" that a file-reader must count by hand); the other
  five are ordinary navigation questions any agent must answer.
- Small n (6 tasks, 1 repo). This measures the *shape* of the advantage, not a leaderboard.
