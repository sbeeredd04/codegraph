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
}

export interface NodeSearchResult {
  readonly address: string;
  readonly name: string;
  readonly kind: string;
  readonly score: number;
  /** Indices into `name` that the query matched, for highlighting (empty when the
   * match was on the address only, or for an empty query). */
  readonly nameMatches: readonly number[];
}

export interface SearchOptions {
  /** Maximum results to return (default 50). */
  readonly limit?: number;
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
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return nodes.slice(0, limit).map((node) => ({ ...node, score: 0, nameMatches: [] }));
  }
  const scored: NodeSearchResult[] = [];
  for (const node of nodes) {
    const hit = scoreNode(node, trimmed);
    if (hit) scored.push({ ...node, score: hit.score, nameMatches: hit.nameMatches });
  }
  scored.sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.address.localeCompare(b.address),
  );
  return scored.slice(0, limit);
}
