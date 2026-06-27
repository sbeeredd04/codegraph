// Where the enrichment cache lives for a repo (Epic 4): one deterministic path
// derived from the repo root, shared by BOTH the standalone MCP server (which
// WRITES annotations) and the extension board (which READS them to display).
// Anchored on the home directory — NOT os.tmpdir() — so the two separate
// processes agree even when the MCP launcher strips TMPDIR (see repo-cache.ts).

import { repoCacheFile } from "../cache/repo-cache.js";

/** The enrichment-cache file path for `root`. Same root → same path (so writer
 * and reader meet); independent of path spelling. `baseDir` is overridable for
 * tests and for an extension that prefers its own storage. */
export function enrichmentCachePath(root: string, baseDir?: string): string {
  return repoCacheFile(root, "enrichment.json", baseDir);
}
