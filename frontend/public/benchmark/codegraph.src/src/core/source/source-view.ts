// Pure source-view model for the node code viewer (FR-15). Given a file's full
// text and a node's 0-based defining line, produce the line array plus a clamped
// anchor index the UI scrolls to and highlights. No I/O — the bytes arrive via
// the `SourceText` outbound port (AD-16, host-local only); this is the display
// math, kept in core so the webview and the Next.js explorer share one contract.

export interface SourceView {
  /** The file split into lines (newline-delimited; a trailing newline yields a final empty line). */
  readonly lines: readonly string[];
  /**
   * 0-based index into `lines` of the node's defining line, clamped into range.
   * The viewer scrolls this into view and highlights it; humans see `anchor + 1`.
   */
  readonly anchor: number;
  /** Total line count — convenient for gutter width and "N lines" affordances. */
  readonly lineCount: number;
}

/**
 * Build the viewer model. `defLine` is the node's 0-based location line (the
 * canonical schema, AD-4); it is clamped to `[0, lines.length - 1]` so a stale
 * or out-of-range line never indexes past the file. Empty text yields a single
 * empty line with anchor 0 (the viewer shows an empty file rather than nothing).
 */
export function buildSourceView(text: string, defLine: number): SourceView {
  const lines = text.split("\n");
  const lastIndex = lines.length - 1;
  const anchor = Math.max(0, Math.min(Math.trunc(defLine), lastIndex));
  return { lines, anchor, lineCount: lines.length };
}
