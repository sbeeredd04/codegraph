import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createBoardServer } from "./server.js";
import type { GraphSnapshot } from "../../core/graph/export.js";

const SNAPSHOT: GraphSnapshot = {
  version: 1,
  nodeCount: 1,
  edgeCount: 0,
  nodes: [{ address: "ts:a.ts#login", kind: "function", name: "login", location: { file: "a.ts", line: 0, character: 0 } }],
  edges: [],
};

function get(server: http.Server, urlPath: string): Promise<{ status: number; body: string; type?: string }> {
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, type: res.headers["content-type"] }));
      })
      .on("error", reject);
  });
}

describe("createBoardServer (FR-88)", () => {
  let dir: string;
  let server: http.Server;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-serve-"));
    fs.writeFileSync(path.join(dir, "index.html"), "<html><head></head><body>board</body></html>");
    fs.writeFileSync(path.join(dir, "app.js"), "console.log('app');");
    server = createBoardServer({ exportDir: dir, snapshot: SNAPSHOT, editorRoot: "/abs/repo" });
    await new Promise<void>((r) => server.listen(0, r));
  });

  afterAll(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("serves index.html with the injected snapshot on /", async () => {
    const res = await get(server, "/");
    expect(res.status).toBe(200);
    expect(res.type).toContain("text/html");
    expect(res.body).toContain("codegraph:snapshot");
    expect(res.body).toContain("ts:a.ts#login");
    expect(res.body).toContain("/abs/repo"); // editorRoot rides along
  });

  it("serves a static asset with the right content-type, unmodified", async () => {
    const res = await get(server, "/app.js");
    expect(res.status).toBe(200);
    expect(res.type).toContain("text/javascript");
    expect(res.body).toBe("console.log('app');");
  });

  it("falls back to the injected board for an unknown route (single-page)", async () => {
    const res = await get(server, "/some/deep/route");
    expect(res.status).toBe(200);
    expect(res.body).toContain("codegraph:snapshot");
  });

  it("refuses to serve outside the export dir (path-traversal guard)", async () => {
    const res = await get(server, "/../../etc/hosts");
    expect(res.status).toBe(403);
  });

  it("refuses to follow a symlink that escapes the export dir (T11.3)", async () => {
    // A secret file OUTSIDE the served dir, exposed via a symlink INSIDE it.
    const secret = path.join(os.tmpdir(), `codegraph-secret-${process.pid}.txt`);
    fs.writeFileSync(secret, "TOP SECRET");
    const link = path.join(dir, "leak.txt");
    try {
      fs.symlinkSync(secret, link);
    } catch {
      return; // symlinks unavailable on this platform — skip
    }
    const res = await get(server, "/leak.txt");
    fs.rmSync(link, { force: true });
    fs.rmSync(secret, { force: true });
    expect(res.status).toBe(403);
    expect(res.body).not.toContain("TOP SECRET");
  });

  it("rejects an overlong request path (T11.3)", async () => {
    const res = await get(server, `/${"a".repeat(5000)}`);
    expect(res.status).toBe(414);
  });

  it("rejects a malformed percent-encoding (T11.3)", async () => {
    const res = await get(server, "/%E0%A4%A"); // truncated escape → decode throws
    expect(res.status).toBe(400);
  });
});
