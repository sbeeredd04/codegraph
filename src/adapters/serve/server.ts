import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import type { GraphSnapshot } from "../../core/graph/export.js";
import { injectSnapshot } from "./inject.js";

// FR-88 — the minimal static server behind `codegraph serve`. Serves ONLY the Next
// export directory (media/explorer), rewriting index.html to carry the live snapshot
// (see inject.ts). Read-only, host-local, no dependencies beyond node builtins.

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
  const { snapshot, editorRoot } = options;

  return http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
      const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
      const abs = path.resolve(exportDir, rel);

      // Path-traversal guard: only ever serve inside exportDir.
      if (abs !== exportDir && !abs.startsWith(exportDir + path.sep)) {
        res.writeHead(403).end("Forbidden");
        return;
      }

      const file =
        fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : path.join(exportDir, "index.html");

      if (path.basename(file) === "index.html") {
        const html = fs.readFileSync(file, "utf8");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(injectSnapshot(html, snapshot, editorRoot));
        return;
      }

      const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": type });
      res.end(fs.readFileSync(file));
    } catch {
      res.writeHead(500).end("Internal error");
    }
  });
}
