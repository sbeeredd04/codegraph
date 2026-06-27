// Where the diagram set lives for a repo (Epic 7): one deterministic path
// derived from the repo root, shared by BOTH the standalone MCP server (which
// WRITES the agent's diagrams) and the extension board (which READS them to
// render). A per-repo temp file, persistent across restarts, never in the repo —
// the same scheme as the enrichment cache, in a sibling file.

import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";

/** The diagram-set file path for `root`. Same root → same path (so the writing
 * agent and the reading board meet); independent of path spelling. `baseDir` is
 * overridable for tests and for an extension that prefers workspaceStorage. */
export function diagramsCachePath(
  root: string,
  baseDir: string = path.join(os.tmpdir(), "codegraph"),
): string {
  const key = createHash("sha1").update(path.resolve(root)).digest("hex").slice(0, 16);
  return path.join(baseDir, key, "diagrams.json");
}
