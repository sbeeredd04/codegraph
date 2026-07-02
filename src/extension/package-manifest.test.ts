// Guards the .vsix packaging invariants (T8.2). The extension host + MCP server are
// esbuild-BUNDLED (dist/extension.js, dist/mcp-server.js) with a small externals
// allowlist — only those externals are require()d un-bundled at runtime, so only
// they (plus what carries ajv for the bundled MCP server) belong in `dependencies`
// and ship in the .vsix. Everything else is bundled at build time and must be a
// devDependency, or the package silently re-bloats (it was 56 MB before this split;
// 19 MB after). This reads package.json + .vscodeignore as DATA — it never imports
// the extension entry (which requires `vscode`, absent under vitest).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as {
  main: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const vscodeignore = readFileSync(fileURLToPath(new URL(".vscodeignore", root)), "utf8");

// The esbuild externals (esbuild.js) the shipped node processes require() at
// runtime — these MUST be present so the host can resolve them from node_modules.
// (`vscode` is host-provided, so it is external but NOT a dependency.)
const RUNTIME_EXTERNALS = ["@vscode/tree-sitter-wasm", "ts-morph", "vscode-jsonrpc", "pyright"];
// Bundled into dist/ + media/ by esbuild — never require()d un-bundled, so shipping
// their node_modules trees (mermaid alone drags in cytoscape/katex/d3, ~80 MB) is
// pure bloat. They stay installed as devDependencies for the build.
const BUNDLED_ONLY = ["mermaid", "sigma", "graphology", "graphology-layout-forceatlas2"];

describe("VS Code extension packaging invariants", () => {
  it("entry point is the bundled extension host", () => {
    expect(pkg.main).toBe("./dist/extension.js");
  });

  it("every runtime external is a production dependency (ships in the .vsix)", () => {
    for (const dep of RUNTIME_EXTERNALS) {
      expect(pkg.dependencies, `${dep} must be a runtime dependency`).toHaveProperty(dep);
    }
  });

  it("carries the MCP SDK so its transitive ajv ships for the bundled MCP server", () => {
    expect(pkg.dependencies).toHaveProperty("@modelcontextprotocol/sdk");
  });

  it("bundled-only libraries are NOT production dependencies (kept out of the .vsix)", () => {
    for (const dep of BUNDLED_ONLY) {
      expect(pkg.dependencies, `${dep} is bundled — it must not ship as node_modules`).not.toHaveProperty(dep);
      expect(pkg.devDependencies, `${dep} must remain a devDependency for the build`).toHaveProperty(dep);
    }
  });

  it("exposes a one-command package script that rebuilds the bundle first", () => {
    expect(pkg.scripts.package).toContain("vsce package");
    expect(pkg.scripts["vscode:prepublish"]).toContain("build:explorer");
  });

  it(".vscodeignore keeps source, the frontend workspace, and sourcemaps out of the .vsix", () => {
    for (const pattern of ["src/**", "frontend/**", "dist/**/*.map", "fixtures/**"]) {
      expect(vscodeignore, `.vscodeignore must exclude ${pattern}`).toContain(pattern);
    }
  });
});
