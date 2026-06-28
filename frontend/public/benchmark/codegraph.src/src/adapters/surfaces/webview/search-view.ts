// Pure markup for the command palette (PM-backlog #2). The DOM/keyboard glue lives
// in webview/command-palette.ts; the escaping-sensitive pieces — turning a ranked
// search result into a highlighted, injection-safe option row — live here so they
// are unit-tested under the gate. Node names and addresses come from real source
// and can contain HTML metacharacters, so every interpolated value is escaped.

import { esc } from "./card.js";
import type { NodeSearchResult } from "../../../core/search/node-search.js";

/** The file-path portion of a node address for the palette's dim secondary line:
 * drop the `lang:` prefix and the `#member` suffix (`ts:src/a.ts#foo` → `src/a.ts`). */
export function nodePath(address: string): string {
  const beforeHash = address.split("#", 1)[0];
  const colon = beforeHash.indexOf(":");
  return colon === -1 ? beforeHash : beforeHash.slice(colon + 1);
}

/**
 * Escape `name` and wrap the matched character indices in `<mark>` for highlight.
 * Contiguous matches collapse into a single `<mark>`. Indices are assumed sorted
 * and in range; anything else is simply not highlighted. Every emitted character
 * is escaped, so a name like `<img onerror=…>` can never inject markup.
 */
export function highlightName(name: string, matches: readonly number[]): string {
  if (matches.length === 0) return esc(name);
  const hit = new Set(matches);
  let out = "";
  let run = "";
  let marking = false;
  const flush = (): void => {
    if (run === "") return;
    out += marking ? `<mark>${esc(run)}</mark>` : esc(run);
    run = "";
  };
  for (let i = 0; i < name.length; i++) {
    const isHit = hit.has(i);
    if (isHit !== marking) {
      flush();
      marking = isHit;
    }
    run += name[i];
  }
  flush();
  return out;
}

/**
 * Render the ranked results as `<li role="option">` rows for the palette listbox.
 * Rows are not pre-selected here — the glue marks the active row via
 * `aria-activedescendant` so keyboard navigation owns selection state.
 */
export function paletteRowsHtml(results: readonly NodeSearchResult[]): string {
  return results
    .map(
      (r, i) =>
        `<li role="option" id="cp-opt-${i}" class="cp-row" data-addr="${esc(r.address)}" ` +
        `data-kind="${esc(r.kind)}" aria-selected="false">` +
        `<span class="cp-kind" aria-hidden="true"></span>` +
        `<span class="cp-name">${highlightName(r.name, r.nameMatches)}</span>` +
        `<span class="cp-path">${esc(nodePath(r.address))}</span>` +
        `</li>`,
    )
    .join("");
}
