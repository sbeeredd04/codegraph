// Docstring fallback note (FR-60): a PURE extractor that turns a node's raw
// leading doc-comment — JSDoc, a Python docstring, or a plain leading comment —
// into a short, human-readable note. It is the graceful fallback the detail panel
// shows when a node has no agent grounding yet, so a freshly-indexed board is
// never noteless.
//
// PURITY (AD-1): no I/O, no clock, no source-off-disk. It operates only on text
// already captured by the adapter (`GraphNode.doc`, populated host-side at index
// time). The string it returns is rendered as an escaped React child by the
// frontend — never innerHTML — so a hostile comment cannot inject markup.

/** The longest fallback note we surface; longer prose is clamped on a word boundary. */
const MAX_LEN = 220;

/** JSDoc/TSDoc block tags ("@param", "@returns", …) mark the end of the prose summary. */
const TAG_LINE = /^@\w+/;

/** Python/Google-style section headers that end the one-line summary paragraph. */
const SECTION_HEADER = /^(args|arguments|parameters|returns?|raises?|yields?|examples?|note|notes|see also):/i;

/**
 * Strip the comment delimiters from one raw doc-comment, yielding its inner text
 * lines. Handles the three shapes an indexer is likely to capture:
 *  - JSDoc/TSDoc block:  / **  … * /  with leading `*` gutters
 *  - Python docstring:   """ … """  or  ''' … '''
 *  - leading line run:   // …  or  # …  (one or more lines)
 * Anything else is returned trimmed, line by line.
 */
function stripDelimiters(raw: string): string[] {
  let text = raw.trim();

  // Block comment /** … */ or /* … */
  if (text.startsWith("/*")) {
    text = text.replace(/^\/\*+/, "").replace(/\*+\/$/, "");
    return text.split("\n").map((l) => l.replace(/^\s*\*+ ?/, "").trimEnd());
  }

  // Python triple-quoted docstring
  const triple = text.startsWith('"""') ? '"""' : text.startsWith("'''") ? "'''" : null;
  if (triple) {
    text = text.slice(3);
    if (text.endsWith(triple)) text = text.slice(0, -3);
    return text.split("\n").map((l) => l.trimEnd());
  }

  // A run of single-line comments (// or #), or already-bare prose.
  return text.split("\n").map((l) => l.replace(/^\s*(\/\/\/?|#)\s?/, "").trimEnd());
}

/**
 * Extract a one-paragraph summary from a raw doc-comment, or `null` when there is
 * no usable prose. Takes the FIRST paragraph (up to a blank line, a `@tag`, or a
 * section header), joins its wrapped lines into one line, and clamps the length.
 */
export function extractDocSummary(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== "string") return null;

  const lines = stripDelimiters(raw);
  const summary: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (summary.length > 0) break; // blank line ends the first paragraph
      continue; // skip leading blanks
    }
    if (TAG_LINE.test(trimmed) || SECTION_HEADER.test(trimmed)) break;
    summary.push(trimmed);
  }

  const joined = summary.join(" ").replace(/\s+/g, " ").trim();
  if (joined === "") return null;
  return clamp(joined, MAX_LEN);
}

/** Clamp to `max` chars, cutting on the last word boundary and appending an ellipsis. */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

/** A note derived without any agent grounding. `source` records its provenance so
 * the UI can label it honestly (it is NOT agent-authored). */
export interface FallbackNote {
  readonly body: string;
  readonly source: "docstring";
}

/**
 * Derive a fallback note for a node from its captured doc-comment, or `null` when
 * none is available (no `doc`, or it cleans to nothing). The caller shows this
 * only when there is no agent grounding, clearly distinguished from it.
 */
export function deriveFallbackNote(node: { readonly doc?: string }): FallbackNote | null {
  const body = extractDocSummary(node.doc);
  return body ? { body, source: "docstring" } : null;
}
