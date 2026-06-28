// MCP client config (FR-13 last mile): emit the snippet a user pastes into
// their agent (Claude Code, Cursor, …) to point it at the codegraph server.
// Pure string/object building — no I/O, no vscode (the command in the host
// resolves the real paths and copies the result).

export interface McpServerConfig {
  readonly command: string;
  readonly args: string[];
}

/** Config that launches the bundled MCP server over stdio for one repo. */
export function buildMcpServerConfig(
  serverScriptPath: string,
  repoRoot: string,
  command = "node",
): McpServerConfig {
  return { command, args: [serverScriptPath, repoRoot] };
}

/** A ready-to-paste `mcpServers` block keyed as "codegraph". */
export function mcpConfigSnippet(serverScriptPath: string, repoRoot: string, command = "node"): string {
  return JSON.stringify(
    { mcpServers: { codegraph: buildMcpServerConfig(serverScriptPath, repoRoot, command) } },
    null,
    2,
  );
}
