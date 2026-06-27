import { spawn, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";

export interface LspPosition {
  readonly line: number;
  readonly character: number;
}
export interface LspLocation {
  readonly uri?: string;
  readonly targetUri?: string;
}

/**
 * Minimal LSP client driving the Pyright langserver over stdio — no Python
 * runtime needed (the langserver is a Node script). Proven by bench/pyright-spike.
 */
export class PyrightClient {
  private server: ChildProcess | undefined;
  private conn: MessageConnection | undefined;
  private readonly analyzed = new Set<string>();

  constructor(private readonly rootDir: string) {}

  async start(): Promise<void> {
    const entry = require.resolve("pyright/langserver.index.js");
    this.server = spawn(process.execPath, [entry, "--stdio"], { cwd: this.rootDir });
    this.conn = createMessageConnection(
      new StreamMessageReader(this.server.stdout!),
      new StreamMessageWriter(this.server.stdin!),
    );
    this.conn.onNotification("textDocument/publishDiagnostics", (p: { uri: string }) => {
      this.analyzed.add(p.uri);
    });
    this.conn.listen();

    const rootUri = pathToFileURL(this.rootDir).href;
    await this.conn.sendRequest("initialize", {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: "codegraph" }],
      capabilities: {},
    });
    this.conn.sendNotification("initialized", {});
  }

  didOpen(uri: string, text: string): void {
    this.conn?.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId: "python", version: 1, text },
    });
  }

  /** Resolve definition location(s) at a position. */
  async definition(uri: string, position: LspPosition): Promise<LspLocation[]> {
    if (!this.conn) return [];
    const def = await this.conn.sendRequest("textDocument/definition", {
      textDocument: { uri },
      position,
    });
    return Array.isArray(def) ? (def as LspLocation[]) : def ? [def as LspLocation] : [];
  }

  /** Wait until Pyright has analyzed a doc (diagnostics published) or timeout. */
  async waitForAnalysis(uri: string, timeoutMs = 10000): Promise<void> {
    const start = Date.now();
    while (!this.analyzed.has(uri) && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  dispose(): void {
    try {
      this.conn?.dispose();
    } catch {
      /* ignore */
    }
    this.server?.kill();
  }
}
