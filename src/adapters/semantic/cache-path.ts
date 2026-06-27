// Where the enrichment cache lives for a repo (Epic 4): one deterministic path
// derived from the repo root, shared by BOTH the standalone MCP server (which
// WRITES annotations) and the extension board (which READS them to display). A
// per-repo temp file — persistent across restarts, never written into the repo.

import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";

/** The enrichment-cache file path for `root`. Same root → same path (so writer
 * and reader meet); independent of path spelling. `baseDir` is overridable for
 * tests and for an extension that prefers workspaceStorage. */
export function enrichmentCachePath(
  root: string,
  baseDir: string = path.join(os.tmpdir(), "codegraph"),
): string {
  const key = createHash("sha1").update(path.resolve(root)).digest("hex").slice(0, 16);
  return path.join(baseDir, key, "enrichment.json");
}
