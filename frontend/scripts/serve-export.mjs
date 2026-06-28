// Dependency-free static server for the exported `out/` bundle, mounted under a
// NON-root prefix (default `/out/`). The prefix is the whole point: it forces the
// bundle to resolve every asset against document.baseURI rather than the origin
// root — the exact condition the VS Code webview imposes (its origin is a
// per-session `vscode-webview://<uuid>/…`). If a regression reintroduces a
// root-absolute `/_next/` path, the runtime chunk load 404s here and the export
// smoke test (e2e/export-smoke.spec.ts) fails. Backs that test's webServer.
//
// Usage: node scripts/serve-export.mjs [port] [mountPrefix] [dir]

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? 4321);
const mount = (process.argv[3] ?? "/out/").replace(/\/?$/, "/");
const root = join(here, "..", process.argv[4] ?? "out");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer((req, res) => {
  // Strip query, then the mount prefix. Anything outside the mount is 404.
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (!path.startsWith(mount) && path + "/" !== mount) {
    res.writeHead(404).end("not mounted");
    return;
  }
  let rel = path.slice(mount.length);
  if (rel === "" || rel.endsWith("/")) rel += "index.html";

  // Contain the resolved path to root (defence against `..` traversal).
  const full = normalize(join(root, rel));
  if (!full.startsWith(normalize(root))) {
    res.writeHead(403).end("forbidden");
    return;
  }

  readFile(full)
    .then((buf) => {
      res.writeHead(200, { "content-type": TYPES[extname(full)] ?? "application/octet-stream" });
      res.end(buf);
    })
    .catch(() => {
      res.writeHead(404).end("not found");
    });
});

server.listen(port, () => {
  process.stdout.write(`export smoke server: http://localhost:${port}${mount} -> ${root}\n`);
});
