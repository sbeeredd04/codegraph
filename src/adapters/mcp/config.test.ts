import { describe, it, expect } from "vitest";
import { buildMcpServerConfig, mcpConfigSnippet } from "./config.js";

describe("MCP client config", () => {
  it("builds a server config pointing node at the bundled server + repo root", () => {
    const cfg = buildMcpServerConfig("/ext/dist/mcp-server.js", "/work/repo");
    expect(cfg).toEqual({ command: "node", args: ["/ext/dist/mcp-server.js", "/work/repo"] });
  });

  it("honors a custom node command", () => {
    expect(buildMcpServerConfig("/s.js", "/r", "/usr/local/bin/node").command).toBe(
      "/usr/local/bin/node",
    );
  });

  it("emits a valid, copy-pasteable mcpServers snippet", () => {
    const snippet = mcpConfigSnippet("/ext/dist/mcp-server.js", "/work/repo");
    const parsed = JSON.parse(snippet);
    expect(parsed.mcpServers.codegraph).toEqual({
      command: "node",
      args: ["/ext/dist/mcp-server.js", "/work/repo"],
    });
  });
});
