// FR-59 — input/output shape of a node. A node's `signature` is a single opaque
// string ("foo(a: number, b?: string): Promise<void>"); a reader wants it broken
// into its inputs (parameters with names + types) and its output (return type) so
// the detail panel can present the call's I/O at a glance. This is a pure parse of
// data already on the node — the signature is structural API metadata that already
// rides the snapshot (AD-14 cloud-safe), so no source bytes are read here.
//
// Kept pure (AD-1): a string in, a plain object out. The parser is bracket-aware
// (so commas inside generics / object types / arrow params don't split a param)
// and handles both TS (`: T`) and Python (`-> T`) return syntax. It is a display
// heuristic, not a full type grammar — it degrades to null rather than throwing.

/** One parameter of a node's signature. */
export interface ParamShape {
  readonly name: string;
  readonly type?: string;
  /** Optional via `?`, a default value, or Python keyword default. */
  readonly optional?: boolean;
}

/** The parsed input/output shape of a node's signature. */
export interface SignatureShape {
  readonly params: readonly ParamShape[];
  readonly returns?: string;
}

/**
 * Parse a signature string into its parameter list and return type. Returns null
 * when there's nothing useful to show (no signature, no parameter list, or an
 * empty `()` with no declared return) — the caller falls back to the raw string.
 */
export function parseSignature(signature: string | undefined | null): SignatureShape | null {
  if (!signature) return null;
  const sig = signature.trim();
  const open = sig.indexOf("(");
  if (open === -1) return null;
  const close = matchingParen(sig, open);
  if (close === -1) return null;

  const inner = sig.slice(open + 1, close).trim();
  const params = inner
    ? splitTopLevel(inner, ",")
        .map(parseParam)
        .filter((p): p is ParamShape => p !== null)
    : [];
  const returns = parseReturn(sig.slice(close + 1));

  if (params.length === 0 && !returns) return null;
  return { params, ...(returns ? { returns } : {}) };
}

const OPENERS = "([{<";
const CLOSERS = ")]}";

/** Index of the `)` matching the `(` at `openIdx`, counting only round parens
 * (nested arrow params / callbacks stay balanced); -1 if unbalanced. */
function matchingParen(s: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Bracket depth delta for a char, ignoring `>` that closes a `=>` arrow. */
function depthDelta(c: string, prev: string): number {
  if (OPENERS.includes(c)) return 1;
  if (CLOSERS.includes(c)) return -1;
  if (c === ">" && prev !== "=") return -1; // generic close, not an arrow
  return 0;
}

/** Split `s` on `delim` only where all brackets are balanced (depth 0). Tests
 * the char at its CURRENT depth before applying its own delta, so a `delim` that
 * is itself a bracket is matched at the outer level. */
function splitTopLevel(s: string, delim: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (depth === 0 && s[i] === delim) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
    depth += depthDelta(s[i], s[i - 1] ?? "");
  }
  out.push(s.slice(start));
  return out;
}

/** Index of the first top-level `ch`, or -1. Checks the char before applying its
 * own depth delta, so a bracket char (e.g. a body-opening `{`) is found. */
function indexTopLevel(s: string, ch: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (depth === 0 && s[i] === ch) return i;
    depth += depthDelta(s[i], s[i - 1] ?? "");
  }
  return -1;
}

/** Index of a top-level `=` that introduces a default value — skipping `=>`
 * arrows and the comparison operators (`==`, `<=`, `>=`, `!=`); -1 if none. */
function indexTopLevelDefault(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const prev = s[i - 1] ?? "";
    if (depth === 0 && c === "=" && s[i + 1] !== ">" && s[i + 1] !== "=" && !"=<>!".includes(prev)) {
      return i;
    }
    depth += depthDelta(c, prev);
  }
  return -1;
}

function parseParam(raw: string): ParamShape | null {
  let namePart = raw.trim();
  if (!namePart) return null;
  let typePart: string | undefined;

  const colon = indexTopLevel(namePart, ":");
  if (colon !== -1) {
    typePart = namePart.slice(colon + 1).trim();
    namePart = namePart.slice(0, colon).trim();
  }

  let optional = false;
  if (namePart.endsWith("?")) {
    optional = true;
    namePart = namePart.slice(0, -1).trim();
  }

  // A default value (`= …`) makes the parameter optional; strip it from the type
  // (or from the bare name when there's no annotation).
  if (typePart) {
    const eq = indexTopLevelDefault(typePart);
    if (eq !== -1) {
      optional = true;
      typePart = typePart.slice(0, eq).trim();
    }
  } else {
    const eq = indexTopLevelDefault(namePart);
    if (eq !== -1) {
      optional = true;
      namePart = namePart.slice(0, eq).trim();
    }
  }

  if (!namePart) return null;
  const type = typePart && typePart.length ? typePart : undefined;
  return { name: namePart, ...(type ? { type } : {}), ...(optional ? { optional: true } : {}) };
}

function parseReturn(after: string): string | undefined {
  const s = after.trim();
  let body: string;
  if (s.startsWith("->")) body = s.slice(2); // Python
  else if (s.startsWith(":")) body = s.slice(1); // TypeScript
  else return undefined;
  body = body.trim();
  // Drop a trailing function-body brace ("…): number {") and any trailing `;`.
  const brace = indexTopLevel(body, "{");
  if (brace !== -1) body = body.slice(0, brace).trim();
  body = body.replace(/;+$/, "").trim();
  return body.length ? body : undefined;
}
