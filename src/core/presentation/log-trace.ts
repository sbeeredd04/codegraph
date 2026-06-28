// FR-41 (Epic 19, Phase C): turn a runtime stack trace / error log into a guided
// tour on the graph. The agent (or the human) pastes a trace; this PURE module
// extracts the file:line frames and maps each to the nearest enclosing node, so
// the ordered addresses can feed straight into a `replay` command (replay.ts) —
// an execution-trace walked across the graph.
//
// Pure (no fs / network / vscode): the parser + mapper are unit-tested headlessly.
// The trace text is UNTRUSTED (length/line-capped, tolerant — never throws); the
// OUTPUT is graph-identity addresses only (no source bytes, no absolute path is
// retained downstream), so it stays cloud-safe (AD-14) and read-only (FR-9).

import type { GraphNode, NodeAddress } from "../graph/types.js";

/** One extracted stack frame: a source file + the 1-based line it reported. */
export interface TraceFrame {
  /** path as it appeared in the trace, normalised to forward slashes (scheme stripped). */
  readonly file: string;
  /** 1-based line number, exactly as the trace printed it. */
  readonly line: number;
}

// Untrusted-input guards — a real trace is far under these; the caps bound a
// pathological or adversarial paste so the parser can't be made to churn.
const MAX_TRACE_LEN = 100_000;
const MAX_LINES = 5_000;
const MAX_FRAMES = 200;

/** Strip a `scheme://authority` (or bare `file://`) prefix and tidy `/./`, `./`. */
function normalisePath(raw: string): string {
  let p = raw.trim().replace(/\\/g, "/");
  p = p.replace(/^[a-zA-Z][\w.+-]*:\/\/[^/]*/, ""); // file:// , http://host:port , webpack-internal:///
  p = p.replace(/^\.\//, "").replace(/\/\.\//g, "/");
  return p;
}

// Frame patterns, tried in priority order per line. Each captures (file, line).
const FRAME_PATTERNS: readonly RegExp[] = [
  /\(([^()]+?):(\d+)(?::\d+)?\)\s*$/, // V8 parenthesised: at fn (/abs/file.ts:12:3)
  /\bFile\s+"([^"]+?)",\s+line\s+(\d+)/, // Python: File "x.py", line 42, in fn
  /@(\S+?):(\d+)(?::\d+)?\s*$/, // Firefox: fn@http://host/app.js:12:3
  /\bat\s+(\S+?):(\d+)(?::\d+)?\s*$/, // V8 anonymous: at /abs/file.ts:12:3
  /(\S+?\.[A-Za-z][\w]*):(\d+)(?::\d+)?(?:\s|$)/, // generic tail: file.ext:line(:col)
];

/**
 * Parse a stack trace / error log into ordered frames. Tolerant: lines that match
 * no pattern are skipped, the input is length- and line-capped, and at most
 * MAX_FRAMES are returned. Frames keep their TEXTUAL order (note: V8/Node prints
 * innermost-first, Python outermost-first — the caller decides what to do with it).
 */
export function parseStackTrace(text: unknown): TraceFrame[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const body = text.length > MAX_TRACE_LEN ? text.slice(0, MAX_TRACE_LEN) : text;
  const frames: TraceFrame[] = [];
  const lines = body.split(/\r?\n/, MAX_LINES);
  for (const line of lines) {
    for (const re of FRAME_PATTERNS) {
      const m = re.exec(line);
      if (!m) continue;
      const file = normalisePath(m[1]);
      const lineNo = Number.parseInt(m[2], 10);
      if (file.length > 0 && Number.isFinite(lineNo) && lineNo > 0) {
        frames.push({ file, line: lineNo });
        if (frames.length >= MAX_FRAMES) return frames;
      }
      break; // first matching pattern wins for this line
    }
  }
  return frames;
}

/** True when one normalised path is a path-segment suffix of the other. */
function isPathSuffix(longer: string, shorter: string): boolean {
  return longer === shorter || longer.endsWith("/" + shorter);
}
function filesMatch(frameFile: string, nodeFile: string): boolean {
  return isPathSuffix(frameFile, nodeFile) || isPathSuffix(nodeFile, frameFile);
}

/**
 * Map ordered frames to the ordered node addresses they fall in. For each frame
 * we pick the file whose path best (longest) suffix-matches the frame's file, then
 * the nearest-preceding definition in that file (greatest start line ≤ the frame
 * line) — the enclosing node, since nodes carry only a start line (no end line).
 * Frames that match no file are dropped (graceful degrade); consecutive duplicate
 * addresses are collapsed so recursion / multi-line frames don't stutter the tour.
 */
export function mapTraceToAddresses(
  frames: readonly TraceFrame[],
  nodes: readonly GraphNode[],
): NodeAddress[] {
  if (frames.length === 0 || nodes.length === 0) return [];

  // Index nodes by normalised file, each list sorted ascending by start line.
  const byFile = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const file = normalisePath(node.location.file);
    const list = byFile.get(file);
    if (list) list.push(node);
    else byFile.set(file, [node]);
  }
  for (const list of byFile.values()) {
    list.sort((a, b) => a.location.line - b.location.line);
  }
  const files = [...byFile.keys()];

  const out: NodeAddress[] = [];
  for (const frame of frames) {
    // Best (most specific) matching file for this frame.
    let bestFile: string | null = null;
    for (const file of files) {
      if (filesMatch(frame.file, file) && (bestFile === null || file.length > bestFile.length)) {
        bestFile = file;
      }
    }
    if (bestFile === null) continue; // unmatched frame → dropped

    const list = byFile.get(bestFile)!;
    const frameLine0 = frame.line - 1; // trace is 1-based; node.location.line is 0-based
    let chosen: GraphNode = list[0];
    for (const node of list) {
      if (node.location.line <= frameLine0) chosen = node;
      else break;
    }
    if (out[out.length - 1] !== chosen.address) out.push(chosen.address);
  }
  return out;
}

/** Convenience: parse + map in one call — the ordered tour addresses for a trace. */
export function traceToAddresses(text: unknown, nodes: readonly GraphNode[]): NodeAddress[] {
  return mapTraceToAddresses(parseStackTrace(text), nodes);
}
