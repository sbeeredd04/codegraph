// codegraph agent benchmark (T14.5) — does an AI agent comprehend a codebase
// better WITH codegraph than without it?
//
// FAIR A/B (v2). Each task runs a REAL headless Claude agent (`claude -p ...
// --output-format json`) twice, same model, same prompt:
//   - baseline  : a codegraph-FREE copy of the repo, default file tools only
//                 (Read / Grep / Glob / Bash). The honest "without" condition.
//   - codegraph : a copy WITH the .codegraph/ artifact + the codegraph MCP server
//                 (query / find_path / neighborhood / dependencies / graph_stats).
// (v1 put .codegraph/ in the shared repo, so the "baseline" read the graph REPORT
//  for free — a confound. v2 gives the baseline no codegraph at all.)
//
// We capture the JSON telemetry (turns, token usage, duration, cost) and grade the
// answer against a source-derived key. Honest reporting: whatever the delta is.
//
// Usage:
//   BENCH_BASE_REPO=/path/to/repo-without-codegraph \
//   BENCH_CG_REPO=/path/to/repo-with-codegraph \
//   node bench/agent-benchmark/run.mjs [taskId...]

import { execFileSync } from "node:child_process";
import { writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE_REPO = process.env.BENCH_BASE_REPO; // codegraph-free ("without")
const CG_REPO = process.env.BENCH_CG_REPO; // has .codegraph/ + MCP ("with")
if (!BASE_REPO || !CG_REPO) {
  process.stderr.write("set BENCH_BASE_REPO (codegraph-free) and BENCH_CG_REPO (indexed)\n");
  process.exit(1);
}
const MCP = path.join(HERE, "codegraph-mcp.json");
const MODEL = process.env.BENCH_MODEL || "sonnet";
const OUT_DIR = path.join(HERE, "results");
const RUNS = path.join(OUT_DIR, "runs.jsonl");

// The task set. Every answer is verifiable in the requests source (see README);
// `expect` is a set of ground-truth keywords, `min` how many must appear for a
// correct grade. Deliberately spans both structural questions (where a graph should
// help) and single-file lookups (where grep is already fine) — an honest mix.
const TASKS = [
  { id: "callers", tool: "neighborhood (reverse call edges)",
    q: "Which method or function CALLS `HTTPAdapter.send` — i.e. who invokes the HTTP adapter's send method? Give the calling method's qualified name.",
    expect: ["Session.send", "session"], min: 1 },
  { id: "auth-subclasses", tool: "find_nodes / neighborhood",
    q: "List every authentication handler class that is a subclass of `AuthBase` (directly or indirectly). Give the class names.",
    expect: ["HTTPBasicAuth", "HTTPProxyAuth", "HTTPDigestAuth"], min: 2 },
  { id: "call-path", tool: "find_path",
    q: "Trace the call path from the top-level `requests.get()` function to the method that actually sends the request through an HTTP adapter (`HTTPAdapter.send`). List the intermediate functions/methods in order.",
    expect: ["request", "Session.request", "Session.send", "HTTPAdapter.send", "adapter"], min: 3 },
  { id: "graph-stats", tool: "graph_stats",
    q: "How many modules, classes, functions, and methods are defined in this codebase's source? Give the four counts.",
    expect: ["37", "72", "173", "475", "757"], min: 3 },
  { id: "dependencies", tool: "dependencies",
    q: "What first-party modules (inside this same package, i.e. relative `.` imports — not stdlib or third-party) does `sessions.py` depend on? List the module names.",
    expect: ["adapters", "auth", "cookies", "models", "exceptions", "utils", "hooks", "structures"], min: 4 },
  { id: "api-surface", tool: "find_file / find_symbol",
    q: "What are the public HTTP-verb functions exposed by the top-level `api.py` module in this package? List the function names.",
    expect: ["get", "post", "put", "delete", "head", "patch", "options", "request"], min: 6 },
];

function runClaude(prompt, withCodegraph) {
  const args = ["-p", prompt, "--model", MODEL, "--output-format", "json", "--dangerously-skip-permissions"];
  if (withCodegraph) args.push("--mcp-config", MCP);
  const cwd = withCodegraph ? CG_REPO : BASE_REPO;
  const started = Date.now();
  try {
    const out = execFileSync("claude", args, { cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, json: JSON.parse(out) };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e), wallMs: Date.now() - started };
  }
}

function metrics(j) {
  const u = j.usage || {};
  const inTok = u.input_tokens || 0;
  const outTok = u.output_tokens || 0;
  const cacheRead = u.cache_read_input_tokens || 0;
  const cacheCreate = u.cache_creation_input_tokens || 0;
  return {
    turns: j.num_turns ?? null,
    durationMs: j.duration_ms ?? null,
    costUsd: j.total_cost_usd ?? null,
    inputTokens: inTok,
    outputTokens: outTok,
    cacheRead,
    cacheCreate,
    // Total tokens the model ingested to answer. Includes the shared Claude Code
    // system prompt (large, ~equal both conditions), so the DELTA is the signal.
    totalContext: inTok + cacheRead + cacheCreate,
    result: j.result || "",
  };
}

function grade(text, task) {
  const t = (text || "").toLowerCase();
  const hits = task.expect.filter((k) => t.includes(k.toLowerCase()));
  return { correct: hits.length >= task.min, hits: hits.length, of: task.expect.length };
}

function pct(base, cg) {
  if (!base || typeof base !== "number" || typeof cg !== "number") return "—";
  const d = ((base - cg) / base) * 100;
  return `${d >= 0 ? "−" : "+"}${Math.abs(d).toFixed(0)}%`;
}

const filter = process.argv.slice(2);
const tasks = filter.length ? TASKS.filter((t) => filter.includes(t.id)) : TASKS;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(RUNS, "");

const rows = [];
for (const task of tasks) {
  for (const withCg of [false, true]) {
    const cond = withCg ? "codegraph" : "baseline";
    process.stderr.write(`\n▶ ${task.id} · ${cond} …\n`);
    const prompt = `${task.q}\n\nBe concise.`;
    const r = runClaude(prompt, withCg);
    let row;
    if (!r.ok) {
      row = { task: task.id, cond, error: r.error, correct: false };
    } else {
      const m = metrics(r.json);
      const g = grade(m.result, task);
      row = { task: task.id, cond, ...m, ...g };
      process.stderr.write(
        `  turns=${m.turns} ctx=${m.totalContext}tok out=${m.outputTokens} dur=${(m.durationMs / 1000).toFixed(1)}s $${(m.costUsd ?? 0).toFixed(4)} correct=${g.correct} (${g.hits}/${g.of})\n`,
      );
    }
    rows.push(row);
    appendFileSync(RUNS, JSON.stringify(row) + "\n");
  }
}

// ---- summary ----------------------------------------------------------------
const byTask = new Map();
for (const r of rows) {
  if (!byTask.has(r.task)) byTask.set(r.task, {});
  byTask.get(r.task)[r.cond] = r;
}
const agg = { baseline: {}, codegraph: {} };
for (const k of ["turns", "totalContext", "outputTokens", "durationMs", "costUsd"]) {
  for (const cond of ["baseline", "codegraph"]) {
    const vals = rows.filter((r) => r.cond === cond && typeof r[k] === "number").map((r) => r[k]);
    agg[cond][k] = vals.length ? vals.reduce((a, b) => a + b, 0) : 0;
  }
}
const correctOf = (cond) => rows.filter((r) => r.cond === cond && r.correct).length;

const L = [];
L.push(`# codegraph agent benchmark — results (v2, fair A/B)\n`);
L.push(`Repo: \`${path.basename(CG_REPO)}\` · model: \`${MODEL}\` · ${tasks.length} tasks × 2 conditions (real \`claude -p\` runs).`);
L.push(`Baseline runs on a **codegraph-free** copy (file tools only); codegraph runs on an indexed copy with the MCP. Lower is better for turns/context/time/cost.\n`);
L.push(`## Per-task\n`);
L.push(`| Task | Turns b→cg | Context tok b→cg | Duration b→cg | Correct b/cg |`);
L.push(`|---|---|---|---|---|`);
for (const [id, pair] of byTask) {
  const b = pair.baseline || {}, c = pair.codegraph || {};
  L.push(`| ${id} | ${b.turns ?? "?"}→${c.turns ?? "?"} (${pct(b.turns, c.turns)}) | ${b.totalContext ?? "?"}→${c.totalContext ?? "?"} (${pct(b.totalContext, c.totalContext)}) | ${b.durationMs ? (b.durationMs / 1000).toFixed(0) + "s" : "?"}→${c.durationMs ? (c.durationMs / 1000).toFixed(0) + "s" : "?"} | ${b.correct ? "✓" : "✗"}/${c.correct ? "✓" : "✗"} |`);
}
L.push(`\n## Aggregate (sum across ${tasks.length} tasks)\n`);
L.push(`| Metric | Baseline | codegraph | Δ |`);
L.push(`|---|---|---|---|`);
L.push(`| Turns | ${agg.baseline.turns} | ${agg.codegraph.turns} | ${pct(agg.baseline.turns, agg.codegraph.turns)} |`);
L.push(`| Context tokens | ${agg.baseline.totalContext} | ${agg.codegraph.totalContext} | ${pct(agg.baseline.totalContext, agg.codegraph.totalContext)} |`);
L.push(`| Output tokens | ${agg.baseline.outputTokens} | ${agg.codegraph.outputTokens} | ${pct(agg.baseline.outputTokens, agg.codegraph.outputTokens)} |`);
L.push(`| Duration (s) | ${(agg.baseline.durationMs / 1000).toFixed(0)} | ${(agg.codegraph.durationMs / 1000).toFixed(0)} | ${pct(agg.baseline.durationMs, agg.codegraph.durationMs)} |`);
L.push(`| Cost (USD) | ${agg.baseline.costUsd.toFixed(3)} | ${agg.codegraph.costUsd.toFixed(3)} | ${pct(agg.baseline.costUsd, agg.codegraph.costUsd)} |`);
L.push(`| Correct | ${correctOf("baseline")}/${tasks.length} | ${correctOf("codegraph")}/${tasks.length} | — |`);
L.push(``);

const summary = L.join("\n");
writeFileSync(path.join(OUT_DIR, "summary.md"), summary);
writeFileSync(path.join(OUT_DIR, "results.json"), JSON.stringify({ repo: path.basename(CG_REPO), model: MODEL, rows, agg }, null, 2));
process.stderr.write(`\n${summary}\n\nWrote results/summary.md · results/results.json · results/runs.jsonl\n`);
