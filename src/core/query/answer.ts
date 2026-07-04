// FR-95 — the single model-friendly "ask a question, get a grounded answer" surface
// over the graph. Graphify's killer `query` move: instead of making the agent chain
// find_symbol → describe_node → dependencies, one call takes a natural-language
// question and returns the matching nodes WITH their real edges and file:line
// citations. Grounded like graphify: the answer is assembled ONLY from graph nodes
// and edges — never an invented caller, never a hallucinated relationship. If the
// graph doesn't contain it, the answer says so.
//
// Pure (AD-1): a graph + a question in, a structured answer out. It does NOT call an
// LLM — it hands the host agent a grounded subgraph and lets THAT agent phrase the
// prose (the moat: the user's own agent is the model). renderAnswer() turns the
// structured answer into text for the CLI / a human.

import type { CodeGraph } from "../graph/graph.js";
import type { NodeAddress, NodeKind } from "../graph/types.js";
import { parseScopedQuery } from "../search/node-search.js";
import { findNodes, describeNode, entryPoints, type NodeSummary } from "../graph/query.js";

/** What the question is mostly after — used to order the answer, never to hide data
 *  (every match always carries its calls, dependencies, and callers). */
export type QueryFocus =
  | "callers"
  | "dependencies"
  | "location"
  | "entrypoint"
  | "overview"
  | "general";

export interface AnswerMatch {
  readonly node: NodeSummary;
  /** Outbound `calls` edge targets. */
  readonly calls: readonly NodeAddress[];
  /** Outbound `depends-on` (import) edge targets. */
  readonly dependsOn: readonly NodeAddress[];
  /** Outbound `contains` targets (a module's/class's members). */
  readonly contains: readonly NodeAddress[];
  /** Direct dependents — who calls/imports this (structural containment excluded). */
  readonly calledBy: readonly NodeAddress[];
}

export interface AnswerOverview {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly entryPoints: readonly NodeSummary[];
}

export interface GraphAnswer {
  readonly question: string;
  /** The scope label if the question used an `fn:`/`file:`/`class:` prefix. */
  readonly scope: string | null;
  readonly focus: QueryFocus;
  readonly found: boolean;
  readonly matches: readonly AnswerMatch[];
  /** A repo overview, included when no specific symbol was named or matched, so the
   *  answer is never empty. */
  readonly overview?: AnswerOverview;
  /** The grounding statement — what the answer is (and isn't). */
  readonly note: string;
}

const DEFAULT_MATCHES = 8;

// Question/filler words stripped before ranking, so "what calls the login function"
// reduces to the SUBJECT ("login"). Intent words (call/depends/where/…) are detected
// from the raw question BEFORE stripping, then removed here so they don't pollute the
// symbol search.
const STOP = new Set([
  "what", "which", "who", "how", "why", "where", "when", "is", "are", "the", "a", "an",
  "of", "to", "in", "on", "for", "and", "or", "does", "do", "did", "that", "this",
  "these", "those", "it", "its", "me", "show", "tell", "find", "get", "give", "list",
  "all", "any", "from", "by", "with", "about", "please", "can", "could", "would", "you",
  "i", "we", "my", "our", "graph", "code", "codebase", "repo", "repository", "node",
  "nodes", "symbol", "symbols",
  // intent words — detected separately, then dropped from the subject search
  "call", "calls", "calling", "caller", "callers", "called", "invoke", "invokes",
  "use", "uses", "used", "using", "depend", "depends", "depended", "dependency",
  "dependencies", "import", "imports", "imported", "requires", "require", "need",
  "needs", "defined", "definition", "define", "locate", "location", "entry",
  "entrypoint", "main", "start", "starts", "bootstrap", "overview", "architecture",
  "structure", "packages", "package", "stats", "summary", "function", "functions",
  "file", "files", "class", "classes", "method", "methods", "module", "modules",
]);

/** Read the intent off the raw question. First match wins in a deliberate order:
 *  a specific relationship beats a generic "where". */
function detectFocus(q: string): QueryFocus {
  const s = q.toLowerCase();
  if (/\b(overview|architecture|structure|packages?|stats|summary|how many)\b/.test(s)) return "overview";
  if (/\b(entry\s?points?|entrypoints?|where.*(start|begin)|main|bootstrap)\b/.test(s)) return "entrypoint";
  if (/\b(caller|callers|call|calls|calling|invoke|invoked|who\s+(calls|uses)|used\s+by)\b/.test(s)) return "callers";
  if (/\b(depend|depends|dependenc|import|imports|requires?)\b/.test(s)) return "dependencies";
  if (/\b(where|defined|definition|locate|location)\b/.test(s)) return "location";
  return "general";
}

/** Content tokens: alphanumeric runs, minus stopwords, length ≥ 2. Preserves order
 *  so the most salient noun (usually first) leads the merge. */
function contentTokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[^a-zA-Z0-9_]+/)) {
    if (raw.length < 2) continue;
    if (STOP.has(raw.toLowerCase())) continue;
    out.push(raw);
  }
  return out;
}

function toMatch(graph: CodeGraph, address: NodeAddress): AnswerMatch | undefined {
  const detail = describeNode(graph, address);
  if (!detail) return undefined;
  const targetsOf = (relation: string): readonly NodeAddress[] =>
    detail.outbound.find((o) => o.relation === relation)?.targets ?? [];
  return {
    node: detail.node,
    calls: targetsOf("calls"),
    dependsOn: targetsOf("depends-on"),
    contains: targetsOf("contains"),
    calledBy: detail.dependents,
  };
}

/**
 * Answer a natural-language question from the graph alone. Extracts the subject
 * term(s), ranks nodes for each (reusing the shared fzf scorer via findNodes),
 * merges best-first, and returns each match with its real edges + citations. When
 * nothing specific is named or found, falls back to a repo overview so the answer is
 * grounded and useful rather than empty.
 */
export function answerQuestion(
  graph: CodeGraph,
  question: string,
  opts: { limit?: number } = {},
): GraphAnswer {
  const limit = opts.limit ?? DEFAULT_MATCHES;
  const scoped = parseScopedQuery(question.trim());
  const focus = detectFocus(question);
  // A scope prefix (fn:/file:/class:) yields exactly one kind; SCOPES only holds real
  // NodeKinds, so the cast is sound.
  const kind =
    scoped.kinds && scoped.kinds.length === 1 ? (scoped.kinds[0] as NodeKind) : undefined;

  // A direct address (ts:… / py:…) in the question resolves without ranking.
  const direct: NodeAddress[] = [];
  for (const tok of question.split(/\s+/)) {
    if (/^(ts|py):/.test(tok) && graph.getNode(tok)) direct.push(tok);
  }

  const tokens = contentTokens(scoped.text);
  const seen = new Set<NodeAddress>(direct);
  const ordered: NodeAddress[] = [...direct];
  // Rank per token, then merge preserving best-first within each token and token
  // order across tokens. A scope prefix restricts the kind.
  for (const tok of tokens) {
    for (const hit of findNodes(graph, tok, { kind, limit })) {
      if (seen.has(hit.address)) continue;
      seen.add(hit.address);
      ordered.push(hit.address);
    }
  }

  const matches: AnswerMatch[] = [];
  for (const addr of ordered.slice(0, limit)) {
    const m = toMatch(graph, addr);
    if (m) matches.push(m);
  }

  if (matches.length > 0) {
    return {
      question,
      scope: scoped.scopeLabel,
      focus,
      found: true,
      matches,
      note:
        `Answered from the code graph — ${matches.length} node(s) matched. Every node, ` +
        "edge, and file:line below is a real graph fact; nothing is inferred beyond the graph.",
    };
  }

  // Nothing matched (or the question named no symbol) — hand back a grounded overview
  // instead of an empty answer, and be honest about why.
  const overview: AnswerOverview = {
    nodeCount: graph.order,
    edgeCount: graph.size,
    entryPoints: entryPoints(graph, 5),
  };
  const named = tokens.length > 0 || direct.length > 0;
  return {
    question,
    scope: scoped.scopeLabel,
    focus: focus === "general" ? "overview" : focus,
    found: false,
    matches: [],
    overview,
    note: named
      ? "No graph node matches that. It may not exist, or the term isn't how the code names " +
        "it — try the exact symbol name. (Answered only from the graph — nothing invented.) " +
        "Here is a repo overview instead."
      : "No specific symbol named — here is a repo overview. (Answered only from the graph.)",
  };
}

const cap = (xs: readonly NodeAddress[], n = 12): string => {
  if (xs.length === 0) return "—";
  if (xs.length <= n) return xs.join(", ");
  return `${xs.slice(0, n).join(", ")}, +${xs.length - n} more`;
};

/** Render a {@link GraphAnswer} as grounded text for the CLI / a human reader. */
export function renderAnswer(answer: GraphAnswer): string {
  const lines: string[] = [`Q: ${answer.question}`];
  if (answer.scope) lines.push(`   (scoped to ${answer.scope})`);
  lines.push("", answer.note, "");

  if (answer.found) {
    for (const m of answer.matches) {
      const sig = m.node.signature ? ` ${m.node.signature}` : "";
      lines.push(`• ${m.node.name} (${m.node.kind})  ${m.node.file}:${m.node.line}${sig}`);
      lines.push(`    address: ${m.node.address}`);
      if (m.calledBy.length) lines.push(`    called by: ${cap(m.calledBy)}`);
      if (m.calls.length) lines.push(`    calls: ${cap(m.calls)}`);
      if (m.dependsOn.length) lines.push(`    depends on: ${cap(m.dependsOn)}`);
      if (m.contains.length) lines.push(`    contains: ${cap(m.contains)}`);
      lines.push("");
    }
    return lines.join("\n").trimEnd();
  }

  if (answer.overview) {
    lines.push(`Repo: ${answer.overview.nodeCount} nodes · ${answer.overview.edgeCount} edges`);
    if (answer.overview.entryPoints.length) {
      lines.push("Entry points:");
      for (const ep of answer.overview.entryPoints) {
        lines.push(`  • ${ep.name} (${ep.kind})  ${ep.file}:${ep.line}`);
      }
    }
  }
  return lines.join("\n").trimEnd();
}
