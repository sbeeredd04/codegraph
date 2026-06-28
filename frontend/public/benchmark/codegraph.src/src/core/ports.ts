// Hexagonal ports (spine: the seams adapters implement). Pure type contracts — no I/O.
import type { GraphNode, GraphEdge, GraphDelta } from "./graph/types.js";

/** Inbound: a per-language parser turns a file into nodes + edges. */
export interface LanguageAdapter {
  readonly language: string;
  parseFile(path: string, source: string): { nodes: GraphNode[]; edges: GraphEdge[] };
}

/** Inbound: a source of change events (file-watcher, git, GitHub PR). */
export interface ChangeSource {
  readonly id: string;
  start(onChange: (changedPaths: readonly string[]) => void): void;
  stop(): void;
}

/** Outbound: a consumer of graph deltas (webview, MCP server). */
export interface GraphConsumer {
  readonly id: string;
  apply(delta: GraphDelta): void;
}

/** Outbound: the bring-your-own-model provider for enrichment (AD-5). Optional by design. */
export interface ModelProvider {
  readonly id: string;
  describe(prompt: string): Promise<string>;
}

/**
 * Outbound: read-only access to a file's source text by repo-relative path, for
 * the node source-code viewer (FR-15). Host-LOCAL only — the VS Code extension
 * reads via `vscode.workspace.fs`, `codegraph serve` via Node `fs`; the hosted
 * plane has no filesystem and returns `null` (AD-16). Never writes (FR-9, passive).
 */
export interface SourceText {
  /** The file's full text, or `null` when it can't be read (missing / no host FS). */
  readFile(relPath: string): Promise<string | null>;
}
