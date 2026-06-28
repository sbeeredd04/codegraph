// Where the overlay set lives for a repo (Epic 19 / FR-37 companion to docs +
// diagrams): one deterministic path derived from the repo root, shared by BOTH
// the standalone MCP server (which WRITES the agent's notes/marks/groups via the
// overlay tools) and the extension board (which READS them to render) — a sibling
// file to the diagram + doc + enrichment caches. Anchored on the home directory
// (NOT os.tmpdir()) so the two separate processes agree even when the MCP launcher
// strips TMPDIR (see repo-cache.ts).

import { repoCacheFile } from "../cache/repo-cache.js";

/** The overlay-set file path for `root`. Same root → same path (so the writing
 * agent and the reading board meet); independent of path spelling. `baseDir` is
 * overridable for tests and for an extension that prefers its own storage. */
export function overlaysCachePath(root: string, baseDir?: string): string {
  return repoCacheFile(root, "overlays.json", baseDir);
}
