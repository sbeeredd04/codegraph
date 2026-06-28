// Pure builder for "open this file in my editor" deep links (FR-32). codegraph
// never opens an editor itself — it hands the OS a URL the installed editor
// registered (vscode://, cursor://, …) and the editor jumps to the file:line.
//
// Two invariants make this safe to share across planes:
//   1. The absolute repo root lives only on the host that owns the source
//      (AD-16) and is supplied at the transport layer — it is NEVER persisted in
//      the portable GraphSnapshot, so a shared or cloud-hosted snapshot can't
//      leak a filesystem layout (AD-14). When no absolute root is known, the
//      builder returns null and the surface withholds the affordance.
//   2. The file is treated as untrusted node data: an absolute or parent-
//      escaping (`..`) path yields null rather than a link that points outside
//      the repo.
//
// Pure (no vscode, no node:path, no I/O) so it is reachable from the frontend
// via the core glob and unit-testable in isolation.

export type EditorId = "vscode" | "vscode-insiders" | "cursor" | "windsurf";

export interface EditorDescriptor {
  readonly id: EditorId;
  readonly label: string;
  /** URI scheme the installed editor registers for file deep-links. */
  readonly scheme: string;
}

/** The editors whose file deep-link schemes we emit. All share VS Code's
 *  `<scheme>://file/<abs-path>:<line>:<col>` shape (Cursor/Windsurf are forks). */
export const EDITORS: readonly EditorDescriptor[] = [
  { id: "vscode", label: "VS Code", scheme: "vscode" },
  { id: "vscode-insiders", label: "VS Code Insiders", scheme: "vscode-insiders" },
  { id: "cursor", label: "Cursor", scheme: "cursor" },
  { id: "windsurf", label: "Windsurf", scheme: "windsurf" },
];

export const DEFAULT_EDITOR: EditorId = "vscode";

/** Look up an editor descriptor by id, falling back to the default. */
export function editorById(id: EditorId | undefined): EditorDescriptor {
  return EDITORS.find((e) => e.id === id) ?? EDITORS[0];
}

export interface EditorLinkRequest {
  /** Which editor's scheme to target (defaults to VS Code). */
  readonly editor?: EditorId;
  /** Absolute repo root on the host that owns the source; null/undefined → no link. */
  readonly root: string | null | undefined;
  /** Repo-relative file path (a node's `location.file`). */
  readonly file: string;
  /** 0-based defining line (a node's `location.line`); rendered 1-based. */
  readonly line?: number;
  /** 0-based column (a node's `location.character`); rendered 1-based. */
  readonly column?: number;
}

/** POSIX (`/…`) or Windows (`C:\…` / `C:/…`) absolute path. */
function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}

/** A finite, non-negative integer line/column we can safely render 1-based. */
function isPositionable(n: number | undefined): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

/**
 * Percent-encode a path for a deep link without mangling its separators or a
 * Windows drive colon. Each segment is encoded (so spaces, `#`, `?`, … are made
 * safe), then drive/segment colons are restored — VS Code expects a literal
 * `c:` and a literal `:line:col` suffix, not `%3A`.
 */
function encodePath(path: string): string {
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg).replace(/%3A/gi, ":"))
    .join("/");
}

/**
 * Build an editor deep link, or null when one can't be formed safely:
 *   - no absolute `root` (unknown / cloud plane — stays source-blind), or
 *   - an empty `file`, an absolute `file`, or one that escapes the root via `..`.
 *
 * The line/column are accepted 0-based (matching a node's `location`) and
 * rendered 1-based, as VS Code's URL handler expects.
 */
export function buildEditorLink(req: EditorLinkRequest): string | null {
  const root = req.root;
  if (!root || !isAbsolutePath(root)) return null;

  const file = req.file?.trim();
  if (!file) return null;

  // Normalize separators; reject anything that wouldn't stay inside the root.
  const relative = file.replace(/\\/g, "/").replace(/^\.\//, "");
  if (relative.startsWith("/") || isAbsolutePath(relative)) return null;
  const segments = relative.split("/").filter((s) => s.length > 0 && s !== ".");
  if (segments.length === 0 || segments.includes("..")) return null;

  // Join root + file into one absolute path with single `/` separators, then
  // ensure exactly one leading slash (Windows `C:/…` needs one prepended;
  // POSIX `/…` already has it) so the result is `<scheme>://file/<abs>`.
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const absolute = `${normalizedRoot}/${segments.join("/")}`;
  const pathPart = absolute.startsWith("/") ? absolute : `/${absolute}`;

  let suffix = "";
  if (isPositionable(req.line)) {
    suffix = `:${req.line + 1}`;
    if (isPositionable(req.column)) suffix += `:${req.column + 1}`;
  }

  const { scheme } = editorById(req.editor);
  return `${scheme}://file${encodePath(pathPart)}${suffix}`;
}
