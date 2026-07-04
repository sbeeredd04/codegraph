import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import type { GraphSnapshot } from "../../core/graph/export.js";
import { injectSnapshot } from "./inject.js";

// FR-88 — the minimal static server behind `codegraph serve`. Serves ONLY the Next
// export directory (media/explorer), rewriting index.html to carry the live snapshot
// (see inject.ts). Read-only, host-local, no dependencies beyond node builtins.
//
// T11.3 hardening: the request path is untrusted input. Beyond the textual traversal
// guard, we reject overlong / malformed URLs and re-check the RESOLVED file's realpath
// so a symlink planted inside the export dir can never serve a file outside it.

/** Cap on the raw request-target length — a defensive bound so a pathological URL is
 *  rejected cheaply before any path work. */
const MAX_URL_LENGTH = 4096;

/** decodeURIComponent that returns null instead of throwing on a malformed `%` escape. */
function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/** realpathSync that returns null instead of throwing (missing path / broken symlink). */
function safeRealpath(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/** True when `child` is `parent` itself or lives under it (path-segment aware). */
function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + path.sep);
}

/** True when `p` exists and is a regular file (never throws). */
function existsAsFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

export interface BoardServerOptions {
  /** The static Next export to serve (media/explorer). */
  readonly exportDir: string;
  /** The scanned graph to hand the board. */
  readonly snapshot: GraphSnapshot;
  /** Absolute repo root for FR-32 editor deep links (local plane only). */
  readonly editorRoot?: string;
}

/**
 * Build (but do not start) the local board server. The caller `.listen()`s it on a
 * port. Every index.html response is rewritten to inject the snapshot; every other
 * path serves a static file from `exportDir`, guarded against path traversal so a
 * crafted URL can never escape the export directory. Unknown routes fall back to the
 * board (single-page). Read-only (FR-9) — it never writes the tree.
 */
export function createBoardServer(options: BoardServerOptions): http.Server {
  const exportDir = path.resolve(options.exportDir);
  // The export dir's own realpath — the boundary every served file must resolve inside.
  const realExportDir = safeRealpath(exportDir) ?? exportDir;
  const indexHtml = path.join(exportDir, "index.html");
  const { snapshot, editorRoot } = options;

  return http.createServer((req, res) => {
    try {
      const raw = req.url ?? "/";
      if (raw.length > MAX_URL_LENGTH) {
        res.writeHead(414).end("URI Too Long");
        return;
      }
      const decoded = safeDecode(raw.split("?")[0]);
      if (decoded === null) {
        res.writeHead(400).end("Bad Request"); // malformed percent-encoding
        return;
      }
      const rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
      const abs = path.resolve(exportDir, rel);

      // Textual traversal guard: the resolved path must be inside exportDir (path.resolve
      // has already collapsed any `..`). Then pick the file (SPA fallback → index.html).
      if (!isInside(abs, exportDir)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      const candidate = existsAsFile(abs) ? abs : indexHtml;

      // Symlink guard: re-check the REAL path so a symlink inside exportDir that points
      // outside it can never be served (defense-in-depth beyond the textual guard).
      const real = safeRealpath(candidate);
      if (!real || !isInside(real, realExportDir)) {
        res.writeHead(403).end("Forbidden");
        return;
      }

      if (path.basename(candidate) === "index.html") {
        const html = fs.readFileSync(candidate, "utf8");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(injectSnapshot(html, snapshot, editorRoot));
        return;
      }

      const type = CONTENT_TYPES[path.extname(candidate).toLowerCase()] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": type });
      res.end(fs.readFileSync(candidate));
    } catch {
      res.writeHead(500).end("Internal error");
    }
  });
}
