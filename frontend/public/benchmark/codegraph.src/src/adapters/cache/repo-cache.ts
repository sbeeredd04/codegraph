// Where codegraph's per-repo caches live (enrichment + diagrams). The defining
// constraint: this path is computed independently by TWO processes that must
// meet at the same file — the extension host (which READS) and the standalone
// MCP server (which WRITES, spawned by the user's AI client). If they disagree,
// the moat silently breaks: the agent's annotations and diagrams never reach the
// board.
//
// We deliberately do NOT anchor on os.tmpdir(). The MCP SDK's StdioClientTransport
// spawns the server with a stripped environment whose inherited-var allowlist
// (HOME, PATH, SHELL, USER, …) does NOT include TMPDIR — so os.tmpdir() falls
// back to /tmp in the server while the host keeps /var/folders/.../T on macOS,
// and the two never share a file. os.homedir() resolves from HOME (which IS
// inherited) and from getpwuid even when HOME is absent, so it agrees across both
// processes and platforms. An explicit CODEGRAPH_CACHE_DIR (set on both sides)
// overrides everything for users who want a known location.

import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";

/**
 * The base directory for all per-repo caches. Stable across the extension host
 * and the separately-spawned MCP server (see file header). Honors an explicit
 * `CODEGRAPH_CACHE_DIR`, else `~/.codegraph/cache`.
 */
export function codegraphCacheBase(): string {
  const override = process.env.CODEGRAPH_CACHE_DIR;
  if (override && override.trim()) return override;
  return path.join(os.homedir(), ".codegraph", "cache");
}

/**
 * Deterministic per-repo cache file: `<base>/<sha1(resolve(root))[:16]>/<name>`.
 * Same root → same path (so the writing agent and the reading board meet),
 * independent of how the root path is spelled. `baseDir` overrides the base
 * (tests, or an extension that prefers its own storage).
 */
export function repoCacheFile(root: string, name: string, baseDir: string = codegraphCacheBase()): string {
  const key = createHash("sha1").update(path.resolve(root)).digest("hex").slice(0, 16);
  return path.join(baseDir, key, name);
}
