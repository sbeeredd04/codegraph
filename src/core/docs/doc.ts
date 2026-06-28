// Agent-authored knowledge docs (Epic 7 companion to diagrams / FR-29). Long-form
// Markdown the connected AI agent writes ABOUT a repo — onboarding guides, module
// deep-dives, "how this subsystem fits together". Three layers of understanding:
// the graph is precise STRUCTURE, diagrams are NARRATIVE shapes, docs are PROSE.
// The agent explores the graph via the MCP query tools, writes docs (save_doc),
// and codegraph caches and renders them on the board and the web explorer. Same
// moat as the diagrams: the user's own AI does the synthesis, no key in the IDE.
//
// This module is pure: types, validation, and immutable set updates. The Markdown
// is agent-written and therefore UNTRUSTED — it is length-capped here and
// SANITIZED (DOMPurify, a strict tag/attribute allowlist) at the render edge,
// never injected raw. No I/O, no clock (the writer injects updatedAt).

/** Suggested doc categories surfaced to the agent. Stored as a free string (the
 * agent decides); this list only seeds the tool description and grouping hints. */
export const KNOWN_DOC_CATEGORIES = [
  "guide",
  "architecture",
  "reference",
  "onboarding",
  "module",
  "other",
] as const;

export const DOC_SET_VERSION = 1 as const;

// Untrusted-input guards. A real doc is well under these; the caps exist so a
// misbehaving or adversarial writer cannot bloat the cache.
const MAX_MARKDOWN = 200_000;
const MAX_TITLE = 200;
const MAX_RELATED = 200;

export interface Doc {
  /** Stable `category/title` slug — the same pair upserts in place. */
  readonly id: string;
  readonly title: string;
  readonly category: string;
  /** Markdown body (agent-written, untrusted). */
  readonly markdown: string;
  /** Graph node addresses this doc is about, linking doc <-> graph. */
  readonly related?: readonly string[];
  /** ISO timestamp; injected by the writer (this module reads no clock). */
  readonly updatedAt?: string;
}

export interface DocSet {
  readonly version: number;
  readonly docs: readonly Doc[];
}

export interface DocInput {
  title?: unknown;
  category?: unknown;
  markdown?: unknown;
  related?: unknown;
  updatedAt?: unknown;
}

export type ValidateDocResult =
  | { readonly ok: true; readonly doc: Doc }
  | { readonly ok: false; readonly error: string };

export type ParseDocSetResult =
  | { readonly ok: true; readonly set: DocSet }
  | { readonly ok: false; readonly error: string };

/** URL/id-safe slug: lowercase, non-alphanumerics collapsed to single dashes. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Stable identity for a doc: `category/title`, both slugged, with safe fallbacks
 * so the id is always non-empty and well-formed. */
export function docId(category: string, title: string): string {
  return `${slugify(category) || "other"}/${slugify(title) || "doc"}`;
}

/** The agent's category, cleaned — kept as the agent's own vocabulary (trimmed +
 * lowercased) so categorization stays flexible; empty defaults to "guide". */
export function normalizeCategory(raw: string): string {
  return raw.trim().toLowerCase() || "guide";
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Validate and normalize untrusted doc input (from the save_doc tool or a
 * hand-edited cache file) into a {@link Doc}. Never throws — returns a tagged
 * result. This is the single validation path for both write and load.
 */
export function validateDoc(input: DocInput): ValidateDocResult {
  const title = asString(input.title).trim();
  if (!title) return { ok: false, error: "A doc needs a non-empty title." };
  if (title.length > MAX_TITLE) return { ok: false, error: `Title exceeds ${MAX_TITLE} characters.` };

  if (typeof input.markdown !== "string") {
    return { ok: false, error: "A doc needs Markdown content (a string)." };
  }
  const markdown = input.markdown.trim();
  if (!markdown) return { ok: false, error: "The Markdown content is empty." };
  if (markdown.length > MAX_MARKDOWN) {
    return { ok: false, error: `Markdown exceeds ${MAX_MARKDOWN} characters.` };
  }

  const category = normalizeCategory(asString(input.category));

  let related: string[] | undefined;
  if (Array.isArray(input.related)) {
    const cleaned = input.related
      .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
      .map((r) => r.trim())
      .slice(0, MAX_RELATED);
    related = cleaned.length ? cleaned : undefined;
  }

  const updatedAt = typeof input.updatedAt === "string" ? input.updatedAt : undefined;

  const doc: Doc = {
    id: docId(category, title),
    title,
    category,
    markdown,
    ...(related ? { related } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
  return { ok: true, doc };
}

/** An empty, versioned set — the starting point for a repo with no docs. */
export function emptyDocSet(): DocSet {
  return { version: DOC_SET_VERSION, docs: [] };
}

/** Insert `doc`, replacing any existing doc with the same id in place (so
 * re-saving a guide updates it rather than duplicating). Immutable. */
export function upsertDoc(set: DocSet, doc: Doc): DocSet {
  const idx = set.docs.findIndex((d) => d.id === doc.id);
  const docs = idx === -1 ? [...set.docs, doc] : set.docs.map((d, i) => (i === idx ? doc : d));
  return { version: set.version, docs };
}

/** Remove the doc with `id` (no-op if absent). Immutable. */
export function removeDoc(set: DocSet, id: string): DocSet {
  return { version: set.version, docs: set.docs.filter((d) => d.id !== id) };
}

/**
 * Parse a serialized {@link DocSet}, tolerating a partly-corrupt or hand-edited
 * file: malformed individual docs are dropped (re-validated through
 * {@link validateDoc}) rather than failing the whole load. Never throws.
 */
export function parseDocSet(text: string): ParseDocSetResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON." };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Expected a doc-set object." };
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.docs)) {
    return { ok: false, error: "Expected a `docs` array." };
  }
  const docs: Doc[] = [];
  for (const entry of obj.docs) {
    const r = validateDoc((entry ?? {}) as DocInput);
    if (r.ok) docs.push(r.doc);
  }
  const version = typeof obj.version === "number" ? obj.version : DOC_SET_VERSION;
  return { ok: true, set: { version, docs } };
}

/**
 * Outbound port for persisting a repo's doc set (Epic 7). The MCP tools and the
 * board talk to this; a disk-backed adapter implements it. Kept in core as an
 * interface only — no I/O here (AD-1).
 */
export interface DocStore {
  /** Every doc saved for the repo. */
  all(): Promise<DocSet>;
  /** Insert or replace a doc (by its id). */
  save(doc: Doc): Promise<void>;
  /** Remove a doc by id; resolves false if it was not present. */
  remove(id: string): Promise<boolean>;
}

/** Group a set's docs by category, preserving first-seen category order — the
 * board renders one section per category. */
export function docsByCategory(set: DocSet): Map<string, Doc[]> {
  const groups = new Map<string, Doc[]>();
  for (const d of set.docs) {
    const list = groups.get(d.category) ?? [];
    list.push(d);
    groups.set(d.category, list);
  }
  return groups;
}
