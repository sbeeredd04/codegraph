// SPIKE (Story 1.6, panel-flagged #1 risk): can we drive Pyright over LSP from
// Node — no Python runtime — and resolve one accurate cross-file Python edge?
// Go/no-go proof before building the full Python edge resolver.
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pyright-spike-"));
fs.writeFileSync(path.join(dir, "b.py"), "def b():\n    return 1\n");
fs.writeFileSync(path.join(dir, "a.py"), "from b import b\n\ndef a():\n    return b()\n");
const aUri = pathToFileURL(path.join(dir, "a.py")).href;
const bUri = pathToFileURL(path.join(dir, "b.py")).href;
const rootUri = pathToFileURL(dir).href;

const server = spawn(path.resolve("node_modules/.bin/pyright-langserver"), ["--stdio"], { cwd: dir });
const conn = createMessageConnection(
  new StreamMessageReader(server.stdout),
  new StreamMessageWriter(server.stdin),
);
conn.listen();

const timer = setTimeout(() => finish("NO-GO: timeout (no response in 30s)", 2), 30000);

function finish(message: string, code: number): void {
  clearTimeout(timer);
  console.log(message);
  try {
    conn.dispose();
  } catch {
    /* ignore */
  }
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(code);
}

async function main(): Promise<void> {
  await conn.sendRequest("initialize", {
    processId: process.pid,
    rootUri,
    workspaceFolders: [{ uri: rootUri, name: "spike" }],
    capabilities: {},
  });
  conn.sendNotification("initialized", {});

  const open = (uri: string, file: string) =>
    conn.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId: "python", version: 1, text: fs.readFileSync(file, "utf8") },
    });
  open(bUri, path.join(dir, "b.py"));
  open(aUri, path.join(dir, "a.py"));

  // Wait until Pyright has analyzed a.py (diagnostics published), or 6s.
  await new Promise<void>((resolve) => {
    let done = false;
    const settle = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    conn.onNotification("textDocument/publishDiagnostics", (p: { uri: string }) => {
      if (p.uri === aUri) settle();
    });
    setTimeout(settle, 6000);
  });

  // `b` in `return b()` -> line 3, character 11.
  const def = await conn.sendRequest("textDocument/definition", {
    textDocument: { uri: aUri },
    position: { line: 3, character: 11 },
  });
  console.log("definition result:", JSON.stringify(def));
  const locs = Array.isArray(def) ? def : def ? [def] : [];
  const resolved = locs.some((l: { uri?: string; targetUri?: string }) =>
    (l.uri ?? l.targetUri ?? "").includes("b.py"),
  );
  finish(resolved ? "GO: Pyright resolved the cross-file call to b.py (no Python runtime)" : "NO-GO: did not resolve to b.py", resolved ? 0 : 1);
}

main().catch((err) => finish(`NO-GO: error ${(err as Error).message}`, 1));
