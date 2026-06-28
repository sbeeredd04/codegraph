// Minimal, dependency-free TS/JS lexer for the read-only source viewer (FR-15).
// It threads block-comment / string state across lines so multi-line constructs
// color correctly, then emits tokens grouped per line. Output is rendered as
// React text spans (auto-escaped) — never innerHTML — so untrusted source can
// never inject markup. Highlighting is cosmetic; on any ambiguity it falls back
// to a plain token rather than guessing.

export type TokenType = "plain" | "comment" | "string" | "keyword" | "number";

export interface Token {
  readonly value: string;
  readonly type: TokenType;
}

const KEYWORDS = new Set([
  "import", "from", "export", "default", "const", "let", "var", "function",
  "return", "if", "else", "for", "while", "do", "switch", "case", "break",
  "continue", "new", "delete", "class", "extends", "implements", "interface",
  "type", "enum", "public", "private", "protected", "readonly", "static",
  "async", "await", "yield", "typeof", "instanceof", "in", "of", "void", "this",
  "super", "null", "undefined", "true", "false", "try", "catch", "finally",
  "throw", "as", "is", "namespace", "declare", "abstract", "get", "set",
  "satisfies", "keyof", "infer", "module", "require",
]);

const ID_START = /[A-Za-z_$]/;
const ID_PART = /[A-Za-z0-9_$]/;

/**
 * Tokenize TS/JS into a flat token stream. Newlines are preserved inside token
 * values (a block comment or template literal may span lines); `tokenizeLines`
 * re-splits on them. This is a pragmatic lexer, not a spec-complete one.
 */
export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = src.length;
  const push = (value: string, type: TokenType): void => {
    if (value) out.push({ value, type });
  };

  while (i < n) {
    const c = src[i];
    const next = src[i + 1];

    // Line comment → to end of line (not including the newline).
    if (c === "/" && next === "/") {
      let j = i + 2;
      while (j < n && src[j] !== "\n") j++;
      push(src.slice(i, j), "comment");
      i = j;
      continue;
    }
    // Block comment → to closing */ (may span lines).
    if (c === "/" && next === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(n, j + 2);
      push(src.slice(i, j), "comment");
      i = j;
      continue;
    }
    // String / template literal → to matching unescaped quote.
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        j++;
      }
      push(src.slice(i, j), "string");
      i = j;
      continue;
    }
    // Number (decimal / hex / float; no exhaustive exponent handling).
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(next ?? ""))) {
      let j = i + 1;
      while (j < n && /[0-9a-fA-FxXboe._]/.test(src[j])) j++;
      push(src.slice(i, j), "number");
      i = j;
      continue;
    }
    // Identifier / keyword.
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < n && ID_PART.test(src[j])) j++;
      const word = src.slice(i, j);
      push(word, KEYWORDS.has(word) ? "keyword" : "plain");
      i = j;
      continue;
    }
    // Everything else: accumulate a run of plain chars up to the next interesting one.
    let j = i + 1;
    while (
      j < n &&
      !ID_START.test(src[j]) &&
      !/[0-9"'`]/.test(src[j]) &&
      !(src[j] === "/" && (src[j + 1] === "/" || src[j + 1] === "*"))
    ) {
      j++;
    }
    push(src.slice(i, j), "plain");
    i = j;
  }
  return out;
}

/** Tokenize and group tokens by source line, splitting any newline-spanning token. */
export function tokenizeLines(src: string): Token[][] {
  const lines: Token[][] = [[]];
  for (const tok of tokenize(src)) {
    const parts = tok.value.split("\n");
    for (let k = 0; k < parts.length; k++) {
      if (k > 0) lines.push([]);
      if (parts[k]) lines[lines.length - 1].push({ value: parts[k], type: tok.type });
    }
  }
  return lines;
}
