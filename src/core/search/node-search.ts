// Fuzzy node search (PM-backlog #2): rank a repo's nodes against a typed query so
// the board can offer a command-palette jump-to-node. Large graphs are unnavigable
// without it — the architecture report names the load-bearing nodes, and this is
// how a user reaches any of them.
//
// Pure (AD-1): nodes + query in, ranked results out. The scorer is a compact
// fzf-style subsequence matcher — case-insensitive, with bonuses for matches at
// the start, at word/camelCase boundaries, and in consecutive runs, plus a
// dedicated acronym path so "bmr" finds buildMarkdownReport. Names are weighted
// far above the address/path so a name hit always beats an incidental path hit.

export interface SearchableNode {
  readonly address: string;
  readonly name: string;
  readonly kind: string;
  /** The node's file path (module/file location). Shown as a secondary line so
   * same-named symbols are distinguishable at a glance (FR-74). Optional — callers
   * that only rank by name/address need not supply it. Path metadata only, never a
   * source byte, so it is safe on the source-blind plane too (AD-14). */
  readonly path?: string;
}

export interface NodeSearchResult {
  readonly address: string;
  readonly name: string;
  readonly kind: string;
  readonly path?: string;
  readonly score: number;
  /** Indices into `name` that the query matched, for highlighting (empty when the
   * match was on the address only, or for an empty query). */
  readonly nameMatches: readonly number[];
}

export interface SearchOptions {
  /** Maximum results to return (default 50). */
  readonly limit?: number;
  /** Restrict to these node kinds (case-insensitive). Omit / empty = all kinds.
   * Drives the kind-scoped `fn:` / `file:` / `class:` prefixes (FR-74). */
  readonly kinds?: readonly string[];
}

/** A query scoped by a leading `prefix:` — the recognised kinds, the friendly
 * scope label for a UI chip, and the query text with the prefix stripped. */
export interface ScopedQuery {
  readonly kinds: readonly string[] | null;
  readonly scopeLabel: string | null;
  readonly text: string;
}

// The kind-scope prefixes. Aliases share one def object so the map stays terse.
const FN = { kinds: ["function"] as const, label: "functions" };
const FILE = { kinds: ["module"] as const, label: "files" };
const CLASS = { kinds: ["class"] as const, label: "classes" };
const METHOD = { kinds: ["method"] as const, label: "methods" };
const FLOW = { kinds: ["workflow"] as const, label: "workflows" };
const SCOPES: Record<string, { kinds: readonly string[]; label: string }> = {
  fn: FN, func: FN, function: FN,
  file: FILE, mod: FILE, module: FILE,
  class: CLASS, cls: CLASS,
  method: METHOD,
  flow: FLOW, workflow: FLOW,
};

/**
 * Split a leading `prefix:` scope off a query. `"fn:parse"` → restrict to
 * functions, text `"parse"`; `"fn:"` → all functions (empty text); an unknown or
 * absent prefix → `{ kinds: null, text: raw }` unchanged (so `http://x` or a plain
 * query is never mangled). Pure and case-insensitive; the caller feeds `text` +
 * `kinds` into `searchNodes` and shows `scopeLabel` as a removable chip.
 */
export function parseScopedQuery(raw: string): ScopedQuery {
  const m = /^([a-zA-Z]+):(.*)$/.exec(raw);
  if (m) {
    const scope = SCOPES[m[1].toLowerCase()];
    if (scope) return { kinds: scope.kinds, scopeLabel: scope.label, text: m[2].replace(/^\s+/, "") };
  }
  return { kinds: null, scopeLabel: null, text: raw };
}

// Scoring weights — tuned for ordering, not absolute meaning. Tests assert order.
const BASE = 10;
const CONSECUTIVE = 8;
const START = 14;
const BOUNDARY = 10;
const LEADING_PENALTY = 0.5;
const EXACT = 70;
const PREFIX = 28;
const ACRONYM = 44;
const ADDRESS_WEIGHT = 0.4;

const isAlnum = (c: string): boolean => /[a-zA-Z0-9]/.test(c);
const isUpper = (c: string): boolean => c >= "A" && c <= "Z";

/**
 * Greedy left-to-right subsequence match of `query` within `text`. Returns the
 * matched indices and a score (bigger is better), or null if `text` does not
 * contain `query` as a subsequence. Case-insensitive; boundary bonuses read the
 * original casing so camelCase humps count as word starts.
 */
function fuzzy(text: string, query: string): { score: number; indices: number[] } | null {
  if (query.length === 0) return { score: 0, indices: [] };
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  const indices: number[] = [];
  let cursor = 0;
  let score = 0;
  let prev = -2;
  let first = -1;
  for (const ch of q) {
    let found = -1;
    for (let k = cursor; k < t.length; k++) {
      if (t[k] === ch) {
        found = k;
        break;
      }
    }
    if (found === -1) return null;
    if (first === -1) first = found;
    let bonus = BASE;
    if (found === prev + 1) bonus += CONSECUTIVE;
    if (found === 0) bonus += START;
    else {
      const before = text[found - 1];
      const cur = text[found];
      if (!isAlnum(before) || (isUpper(cur) && !isUpper(before))) bonus += BOUNDARY;
    }
    score += bonus;
    indices.push(found);
    prev = found;
    cursor = found + 1;
  }
  return { score: score - first * LEADING_PENALTY, indices };
}

/** The acronym of a name: first letter plus every camelCase hump / post-separator
 * letter. `buildMarkdownReport` and `build_markdown_report` both → "bmr". */
function acronym(name: string): string {
  if (!name) return "";
  let out = name[0];
  for (let i = 1; i < name.length; i++) {
    const cur = name[i];
    const before = name[i - 1];
    if ((isUpper(cur) && !isUpper(before)) || !isAlnum(before)) out += cur;
  }
  return out.toLowerCase();
}

/** Score one node; null if neither its name nor its address matches the query. */
function scoreNode(
  node: SearchableNode,
  query: string,
): { score: number; nameMatches: number[] } | null {
  const q = query.toLowerCase();
  const nameLower = node.name.toLowerCase();

  const nameFuzzy = fuzzy(node.name, query);
  let nameScore = nameFuzzy ? nameFuzzy.score : -Infinity;
  if (nameFuzzy) {
    if (nameLower === q) nameScore += EXACT;
    else if (nameLower.startsWith(q)) nameScore += PREFIX;
    if (acronym(node.name).startsWith(q)) nameScore += ACRONYM;
  }

  const addrFuzzy = fuzzy(node.address, query);
  const addrScore = addrFuzzy ? addrFuzzy.score * ADDRESS_WEIGHT : -Infinity;

  if (nameScore === -Infinity && addrScore === -Infinity) return null;
  return {
    score: Math.max(nameScore, addrScore),
    nameMatches: nameFuzzy ? nameFuzzy.indices : [],
  };
}

/**
 * Rank `nodes` against `query`. An empty/whitespace query returns the first
 * `limit` nodes unscored (so an open palette shows something). Results are sorted
 * by score descending, then name ascending, then address ascending for stability.
 */
export function searchNodes(
  nodes: readonly SearchableNode[],
  query: string,
  opts: SearchOptions = {},
): NodeSearchResult[] {
  const limit = opts.limit ?? 50;
  const kindSet =
    opts.kinds && opts.kinds.length ? new Set(opts.kinds.map((k) => k.toLowerCase())) : null;
  const inKind = (node: SearchableNode): boolean => !kindSet || kindSet.has(node.kind.toLowerCase());
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    // A bare scope (e.g. `fn:`) with no text lists that kind; no scope lists all.
    const base = kindSet ? nodes.filter(inKind) : nodes;
    return base.slice(0, limit).map((node) => ({ ...node, score: 0, nameMatches: [] }));
  }
  const scored: NodeSearchResult[] = [];
  for (const node of nodes) {
    if (!inKind(node)) continue;
    const hit = scoreNode(node, trimmed);
    if (hit) scored.push({ ...node, score: hit.score, nameMatches: hit.nameMatches });
  }
  scored.sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.address.localeCompare(b.address),
  );
  return scored.slice(0, limit);
}
