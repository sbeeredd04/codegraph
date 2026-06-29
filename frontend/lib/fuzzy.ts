// Lightweight subsequence fuzzy matcher for small in-memory lists (the FR-50
// action palette, and FR-49 to come). This is NOT the node-search ranker
// (core/search/node-search.ts, tuned for thousands of graph nodes); it ranks a
// couple dozen command labels. Returns the matched character indices so callers
// can emphasise them, plus a score for ordering.

export interface FuzzyMatch {
  readonly score: number;
  /** Indices into the original text that matched, in order — for highlighting. */
  readonly matches: readonly number[];
}

const BOUNDARY = /[\s/.\-_:]/;

/**
 * Match `query` against `text` as a case-insensitive subsequence. Returns null
 * when a query character cannot be found in order. Higher score is better:
 * contiguous runs and matches at word starts are rewarded; longer haystacks are
 * gently penalised so a tighter label wins on ties. An empty query matches
 * everything with a neutral score and no highlights.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase();
  if (q === "") return { score: 0, matches: [] };

  const lower = text.toLowerCase();
  const matches: number[] = [];
  let qi = 0;
  let score = 0;
  let prev = -2;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] !== q[qi]) continue;
    let bonus = 1;
    if (i === prev + 1) bonus += 4; // contiguous run
    if (i === 0 || BOUNDARY.test(text[i - 1])) bonus += 3; // word boundary
    score += bonus;
    matches.push(i);
    prev = i;
    qi++;
  }
  if (qi < q.length) return null;
  return { score: score - text.length * 0.01, matches };
}
