// Agent-authored knowledge diagrams (Epic 7): the data model for the Mermaid
// diagrams the connected AI agent writes back onto a repo. The graph captures
// precise STRUCTURE; these diagrams capture NARRATIVE — a user workflow end to
// end, the system architecture, a request's sequence — the higher-level mental
// models a newcomer (or the user returning to old code) needs. The agent
// explores the graph via the MCP query tools, synthesizes one or more
// categorized Mermaid diagrams, and saves them (save_diagram); codegraph caches
// and renders them on the board and the standalone viewer. Same moat as
// annotate_node: the user's own AI does the synthesis, no key in the IDE.
//
// This module is pure: types, validation, and immutable set updates. The Mermaid
// source is agent-written and therefore UNTRUSTED — it is length-capped here and
// rendered with Mermaid's strict security level (and escaped chrome) at the edge.

/** Suggested categories surfaced to the agent. The category is stored as a free
 * string (the agent decides — "let the agent decide" per the product intent);
 * this list only seeds the tool description and the board's grouping hints. */
export const KNOWN_DIAGRAM_CATEGORIES = [
  "architecture",
  "workflow",
  "sequence",
  "dataflow",
  "class",
  "state",
  "entity",
  "other",
] as const;

export const DIAGRAM_SET_VERSION = 1 as const;

// Untrusted-input guards. Mermaid source for a real diagram is well under this;
// the cap exists so a misbehaving or adversarial writer cannot bloat the cache.
const MAX_MERMAID = 50_000;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2_000;
const MAX_RELATED = 200;

export interface Diagram {
  /** Stable `category/title` slug — the same pair upserts in place. */
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly description?: string;
  /** Mermaid source (agent-written, untrusted). */
  readonly mermaid: string;
  /** Graph node addresses this diagram is about, linking diagram <-> graph. */
  readonly related?: readonly string[];
  /** ISO timestamp; injected by the writer (this module reads no clock). */
  readonly updatedAt?: string;
}

export interface DiagramSet {
  readonly version: number;
  readonly diagrams: readonly Diagram[];
}

export interface DiagramInput {
  title?: unknown;
  category?: unknown;
  mermaid?: unknown;
  description?: unknown;
  related?: unknown;
  updatedAt?: unknown;
}

export type ValidateDiagramResult =
  | { readonly ok: true; readonly diagram: Diagram }
  | { readonly ok: false; readonly error: string };

export type ParseDiagramSetResult =
  | { readonly ok: true; readonly set: DiagramSet }
  | { readonly ok: false; readonly error: string };

/** URL/id-safe slug: lowercase, non-alphanumerics collapsed to single dashes. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Stable identity for a diagram: `category/title`, both slugged, with safe
 * fallbacks so the id is always non-empty and well-formed. */
export function diagramId(category: string, title: string): string {
  return `${slugify(category) || "other"}/${slugify(title) || "diagram"}`;
}

/** The agent's category, cleaned. Kept as the agent's own vocabulary (trimmed +
 * lowercased) so categorization stays flexible; empty defaults to "other". */
export function normalizeCategory(raw: string): string {
  return raw.trim().toLowerCase() || "other";
}

/** Unwrap a Markdown code fence the agent may have wrapped the source in
 * (```mermaid ... ``` or a bare ``` ... ```), else just trim. Tolerant. */
export function stripMermaidFence(s: string): string {
  const trimmed = s.trim();
  const fence = /^```(?:mermaid)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return fence ? fence[1].trim() : trimmed;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Validate and normalize untrusted diagram input (from the save_diagram tool or
 * a hand-edited cache file) into a {@link Diagram}. Never throws — returns a
 * tagged result. This is the single validation path for both write and load.
 */
export function validateDiagram(input: DiagramInput): ValidateDiagramResult {
  const title = asString(input.title).trim();
  if (!title) return { ok: false, error: "A diagram needs a non-empty title." };
  if (title.length > MAX_TITLE) return { ok: false, error: `Title exceeds ${MAX_TITLE} characters.` };

  if (typeof input.mermaid !== "string") {
    return { ok: false, error: "A diagram needs Mermaid source (a string)." };
  }
  const mermaid = stripMermaidFence(input.mermaid);
  if (!mermaid) return { ok: false, error: "The Mermaid source is empty." };
  if (mermaid.length > MAX_MERMAID) {
    return { ok: false, error: `Mermaid source exceeds ${MAX_MERMAID} characters.` };
  }

  const category = normalizeCategory(asString(input.category));

  const descriptionRaw = asString(input.description).trim().slice(0, MAX_DESCRIPTION);
  const description = descriptionRaw || undefined;

  let related: string[] | undefined;
  if (Array.isArray(input.related)) {
    const cleaned = input.related
      .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
      .map((r) => r.trim())
      .slice(0, MAX_RELATED);
    related = cleaned.length ? cleaned : undefined;
  }

  const updatedAt = typeof input.updatedAt === "string" ? input.updatedAt : undefined;

  const diagram: Diagram = {
    id: diagramId(category, title),
    title,
    category,
    mermaid,
    ...(description ? { description } : {}),
    ...(related ? { related } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
  return { ok: true, diagram };
}

/** An empty, versioned set — the starting point for a repo with no diagrams. */
export function emptyDiagramSet(): DiagramSet {
  return { version: DIAGRAM_SET_VERSION, diagrams: [] };
}

/** Insert `diagram`, replacing any existing diagram with the same id in place
 * (so re-saving a workflow updates it rather than duplicating). Immutable. */
export function upsertDiagram(set: DiagramSet, diagram: Diagram): DiagramSet {
  const idx = set.diagrams.findIndex((d) => d.id === diagram.id);
  const diagrams =
    idx === -1
      ? [...set.diagrams, diagram]
      : set.diagrams.map((d, i) => (i === idx ? diagram : d));
  return { version: set.version, diagrams };
}

/** Remove the diagram with `id` (no-op if absent). Immutable. */
export function removeDiagram(set: DiagramSet, id: string): DiagramSet {
  return { version: set.version, diagrams: set.diagrams.filter((d) => d.id !== id) };
}

/**
 * Parse a serialized {@link DiagramSet}, tolerating a partly-corrupt or
 * hand-edited file: malformed individual diagrams are dropped (re-validated
 * through {@link validateDiagram}) rather than failing the whole load. Never
 * throws — returns a tagged result.
 */
export function parseDiagramSet(text: string): ParseDiagramSetResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON." };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Expected a diagram-set object." };
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.diagrams)) {
    return { ok: false, error: "Expected a `diagrams` array." };
  }
  const diagrams: Diagram[] = [];
  for (const entry of obj.diagrams) {
    const r = validateDiagram((entry ?? {}) as DiagramInput);
    if (r.ok) diagrams.push(r.diagram);
  }
  const version = typeof obj.version === "number" ? obj.version : DIAGRAM_SET_VERSION;
  return { ok: true, set: { version, diagrams } };
}

/**
 * Outbound port for persisting a repo's diagram set (Epic 7). The MCP tools and
 * the board talk to this; a disk-backed adapter implements it. Kept in core as
 * an interface only — no I/O here (AD-1).
 */
export interface DiagramStore {
  /** Every diagram saved for the repo. */
  all(): Promise<DiagramSet>;
  /** Insert or replace a diagram (by its id). */
  save(diagram: Diagram): Promise<void>;
  /** Remove a diagram by id; resolves false if it was not present. */
  remove(id: string): Promise<boolean>;
}

/** Group a set's diagrams by category, preserving first-seen category order —
 * the board renders one section per category. */
export function diagramsByCategory(set: DiagramSet): Map<string, Diagram[]> {
  const groups = new Map<string, Diagram[]>();
  for (const d of set.diagrams) {
    const list = groups.get(d.category) ?? [];
    list.push(d);
    groups.set(d.category, list);
  }
  return groups;
}
