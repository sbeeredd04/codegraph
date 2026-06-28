// Agent onboarding playbook (Epic 19 / FR-42): the connected agent's on-install
// startup checklist. When an agent first attaches to a fresh repo over the
// codegraph MCP, this builds the ordered "how to bootstrap this codebase" plan —
// index it (the server already does that on start), author a starter knowledge
// layer (a few diagrams, an overview doc, hotspot marks), then hand off to the
// human. It is the sibling of assist/ask.ts: that turns a question into a prompt;
// this turns the repo's current state into an ordered, do-this-next plan.
//
// IDEMPOTENT by construction: each step's done/todo status is derived from what is
// ALREADY in the diagram/doc/overlay stores, so re-running after a partial pass
// skips finished work and only recommends the gaps. Re-authoring the same
// title+category upserts in place anyway (the stores are keyed by id), so a re-run
// is always safe.
//
// PURE (AD-1): graph stats + the three knowledge sets in, an ordered plan + a
// human-readable summary out. No I/O, no clock, no LLM — the MCP adapter does the
// reads (graphStats + the stores' .all()) and serves the result.

import type { GraphStats } from "../graph/query.js";
import { type DiagramSet, diagramsByCategory } from "../diagrams/diagram.js";
import type { DocSet } from "../docs/doc.js";
import { type OverlaySet, overlaysByKind } from "../overlays/overlay.js";

export const ONBOARD_PLAYBOOK_VERSION = 1 as const;

export type OnboardStepStatus = "done" | "todo";

export interface OnboardStep {
  /** Stable slug, e.g. "architecture-diagram". */
  readonly id: string;
  readonly title: string;
  readonly status: OnboardStepStatus;
  /** What to do and why — addressed to the connected agent. */
  readonly detail: string;
  /** The codegraph MCP tools this step is carried out with. */
  readonly tools: readonly string[];
}

/** Everything the playbook reads: the graph's shape + what's already authored. */
export interface OnboardContext {
  readonly stats: GraphStats;
  readonly diagrams: DiagramSet;
  readonly docs: DocSet;
  readonly overlays: OverlaySet;
}

export interface OnboardPlaybook {
  readonly version: number;
  /** Has the repo been parsed into a non-empty graph? */
  readonly indexed: boolean;
  readonly steps: readonly OnboardStep[];
  readonly done: number;
  readonly total: number;
  /** Every step done — the starter knowledge layer is in place. */
  readonly complete: boolean;
  /** Human-readable, multi-line checklist + status. */
  readonly summary: string;
  /** The hand-off the agent offers the human once authoring is under way. */
  readonly handoff: string;
}

const HANDOFF =
  'Hand off to the human: ask whether they want to explore the board themselves, or point you at ' +
  'something ("show me the auth flow", "why does X call Y?", "replay this stack trace") — then drive ' +
  "the board for them with guided_tour, highlight_path, focus_camera, or replay_trace.";

const KIND_PLURAL: Record<string, string> = {
  module: "modules",
  class: "classes",
  function: "functions",
  method: "methods",
  workflow: "workflows",
};

/** "12 modules, 1 class, 40 functions" — non-zero kinds only, correctly pluralised. */
function kindBreakdown(byKind: GraphStats["byKind"]): string {
  const parts = (Object.entries(byKind) as [string, number][])
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${n === 1 ? k : KIND_PLURAL[k] ?? `${k}s`}`);
  return parts.length ? parts.join(", ") : "no nodes";
}

/**
 * Build the ordered onboarding plan for a repo from its current state. Pure and
 * deterministic — the same context always yields the same plan, and a step is
 * "done" iff the artifact it recommends already exists (so a re-run skips it).
 */
export function buildOnboardPlaybook(ctx: OnboardContext): OnboardPlaybook {
  const indexed = ctx.stats.nodeCount > 0;
  const diagramCats = diagramsByCategory(ctx.diagrams);
  const hasDiagram = (...cats: string[]): boolean => cats.some((c) => diagramCats.has(c));
  const docCount = ctx.docs.docs.length;
  const { notes, marks } = overlaysByKind(ctx.overlays);

  const steps: OnboardStep[] = [
    {
      id: "index",
      title: "Index the repository",
      status: indexed ? "done" : "todo",
      detail: indexed
        ? `The graph is built — ${ctx.stats.nodeCount} nodes, ${ctx.stats.edgeCount} edges. ` +
          "Orient yourself with graph_stats and a few find_nodes before authoring."
        : "No nodes yet. Point the MCP server at a repo root with parseable source (it indexes on " +
          "start); if it stays empty, check the language coverage.",
      tools: ["graph_stats", "find_nodes"],
    },
    {
      id: "architecture-diagram",
      title: "Draft the architecture diagram",
      status: hasDiagram("architecture") ? "done" : "todo",
      detail:
        "Map the top-level modules and how they depend on each other, then save_diagram with category " +
        "'architecture'. Explore with neighborhood and dependencies first.",
      tools: ["neighborhood", "dependencies", "save_diagram"],
    },
    {
      id: "workflow-diagram",
      title: "Capture a primary workflow",
      status: hasDiagram("workflow") ? "done" : "todo",
      detail:
        "Trace a key end-to-end flow (an entry point to its outcome) with find_path, then save_diagram " +
        "with category 'workflow'.",
      tools: ["find_path", "find_nodes", "save_diagram"],
    },
    {
      id: "flow-diagram",
      title: "Capture a request or data flow",
      status: hasDiagram("sequence", "dataflow") ? "done" : "todo",
      detail:
        "Pick a representative request or data path and capture its call sequence, then save_diagram " +
        "with category 'sequence' (or 'dataflow').",
      tools: ["find_path", "neighborhood", "save_diagram"],
    },
    {
      id: "overview-doc",
      title: "Write a repo overview",
      status: docCount > 0 ? "done" : "todo",
      detail:
        "Write a short orientation doc — what this repo is, its main subsystems, where to start reading " +
        "— and save_doc with category 'onboarding'. Link it back with `related` node addresses.",
      tools: ["graph_stats", "save_doc"],
    },
    {
      id: "hotspots",
      title: "Flag hotspots and gotchas",
      status: marks.length + notes.length > 0 ? "done" : "todo",
      detail:
        "Find the high-impact nodes with blast_radius (and dead-code candidates with list_orphans), then " +
        "mark_node the hotspots, annotate_node what they do, and pin_note any gotcha worth remembering.",
      tools: ["blast_radius", "list_orphans", "mark_node", "annotate_node", "pin_note"],
    },
  ];

  const done = steps.filter((s) => s.status === "done").length;
  const total = steps.length;
  const complete = done === total;
  const summary = renderSummary(ctx, steps, done, total, indexed, complete);

  return { version: ONBOARD_PLAYBOOK_VERSION, indexed, steps, done, total, complete, summary, handoff: HANDOFF };
}

function renderSummary(
  ctx: OnboardContext,
  steps: readonly OnboardStep[],
  done: number,
  total: number,
  indexed: boolean,
  complete: boolean,
): string {
  const lines: string[] = [];
  lines.push(`codegraph onboarding — ${done}/${total} steps complete.`);
  lines.push("");
  lines.push(
    indexed
      ? `Graph: ${ctx.stats.nodeCount} nodes, ${ctx.stats.edgeCount} edges (${kindBreakdown(ctx.stats.byKind)}).`
      : "Graph: empty — the repo isn't indexed yet.",
  );
  lines.push("");
  lines.push("Checklist:");
  for (const s of steps) lines.push(`  [${s.status === "done" ? "x" : " "}] ${s.title}`);
  lines.push("");

  const next = steps.find((s) => s.status === "todo");
  lines.push(next ? `Next: ${next.title} — ${next.detail}` : "All starter artifacts are in place.");
  lines.push("");
  lines.push(complete ? HANDOFF : `Keep authoring the unchecked items, then hand off. ${HANDOFF}`);

  return lines.join("\n");
}
