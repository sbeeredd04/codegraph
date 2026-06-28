// Where the agent's live presentation commands cross the process boundary (Epic
// 19 / FR-39 slice B). UNLIKE the diagram/doc/overlay caches — which persist the
// agent's durable knowledge — this is a TRANSIENT queue: the standalone MCP
// server APPENDS view directives the user's agent issues, and the extension's
// live ExplorerPanel TAILS them and forwards each to its webview. It is never
// folded into a GraphSnapshot, so it carries no durable state and never reaches
// the cloud plane (AD-14); it holds only graph-identity addresses + view
// directives (no source, no absolute host path) and never touches source (FR-9).
//
// Anchored on the home directory (NOT os.tmpdir()) exactly like the persistent
// caches, so the two separate processes agree on the path even when the MCP
// launcher strips TMPDIR (see repo-cache.ts). The `.jsonl` tail is one command
// per line — an ordered stream the panel can drain incrementally by byte offset.

import { repoCacheFile } from "../cache/repo-cache.js";

/** The presentation-command queue path for `root`. Same root → same path (so the
 * emitting MCP server and the draining board meet); independent of path spelling.
 * `baseDir` is overridable for tests and for a host that prefers its own storage. */
export function presentationCommandsPath(root: string, baseDir?: string): string {
  return repoCacheFile(root, "presentation-commands.jsonl", baseDir);
}
