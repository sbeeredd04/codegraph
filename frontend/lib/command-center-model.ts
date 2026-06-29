// FR-49: the command-center model — given the graph's searchable nodes, the live
// action catalogue (the SAME PaletteAction[] the ⌘⇧P palette renders), and a
// query, it produces the unified, grouped result list the Cmd+Space launcher
// shows. Nodes rank via the shared core scorer (node-search.ts, identical to ⌘K);
// actions rank via the shared fuzzy matcher (fuzzy.ts, identical to ⌘⇧P) — so the
// command center never forks ranking or behaviour, it only UNIONS the two
// surfaces. Pure: data in, ordered entries out (testable; keeps the component
// lean and under the file-size cap).

import { searchNodes, type SearchableNode } from "@core/search/node-search";
import { fuzzyMatch } from "@/lib/fuzzy";
import type { PaletteAction } from "@/components/action-palette";

/** A single launcher row: a graph node to jump to, or an action to run. */
export type CommandEntry =
  | {
      readonly kind: "node";
      readonly id: string;
      readonly label: string;
      readonly address: string;
      readonly nodeKind: string;
      readonly matches: readonly number[];
    }
  | {
      readonly kind: "action";
      readonly id: string;
      readonly label: string;
      readonly action: PaletteAction;
      readonly matches: readonly number[];
    };

/** Top graph-node matches to surface (the action set is small; nodes can be huge). */
const NODE_LIMIT = 8;

/**
 * Build the ordered command-center entries for `query`: matching nodes first (the
 * high-frequency "jump to X" intent in a large graph), then actions. An empty
 * query shows the action catalogue only — dumping the whole graph would be noise —
 * so the launcher opens as a browsable menu and reveals nodes on input. Node and
 * action scores live on different scales, so the two are grouped rather than
 * globally interleaved (each ranked by its own scorer), which is also clearer.
 */
export function buildCommandEntries(
  nodes: readonly SearchableNode[],
  actions: readonly PaletteAction[],
  query: string,
): CommandEntry[] {
  const q = query.trim();

  const nodeEntries: CommandEntry[] =
    q === ""
      ? []
      : searchNodes(nodes, q, { limit: NODE_LIMIT }).map((r) => ({
          kind: "node",
          id: `node:${r.address}`,
          label: r.name,
          address: r.address,
          nodeKind: r.kind,
          matches: r.nameMatches,
        }));

  const actionEntries: CommandEntry[] = [];
  if (q === "") {
    for (const a of actions) {
      actionEntries.push({ kind: "action", id: `act:${a.id}`, label: a.label, action: a, matches: [] });
    }
  } else {
    // Fuzzy-filter by label, falling back to the section so e.g. "lens" still finds
    // the lens toggles; the label highlight indices stay valid (section match → []).
    const scored: { entry: CommandEntry; score: number }[] = [];
    for (const a of actions) {
      const onLabel = fuzzyMatch(q, a.label);
      if (onLabel) {
        scored.push({
          entry: { kind: "action", id: `act:${a.id}`, label: a.label, action: a, matches: onLabel.matches },
          score: onLabel.score,
        });
        continue;
      }
      const onSection = a.section ? fuzzyMatch(q, a.section) : null;
      if (onSection) {
        scored.push({
          entry: { kind: "action", id: `act:${a.id}`, label: a.label, action: a, matches: [] },
          score: onSection.score - 2,
        });
      }
    }
    scored.sort((x, y) => y.score - x.score);
    for (const s of scored) actionEntries.push(s.entry);
  }

  return [...nodeEntries, ...actionEntries];
}
