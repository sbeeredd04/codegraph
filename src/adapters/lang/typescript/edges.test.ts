import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { resolveImportEdges } from "./edges.js";

function projectWith(files: Record<string, string>): Project {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [name, content] of Object.entries(files)) project.createSourceFile(name, content);
  return project;
}

describe("resolveImportEdges", () => {
  it("emits a depends-on edge between modules for a resolvable import", () => {
    const project = projectWith({
      "a.ts": `import { b } from "./b";\nexport const a = b;`,
      "b.ts": `export const b = 1;`,
    });
    const edges = resolveImportEdges(project, "/");
    expect(edges).toContainEqual({ from: "ts:a.ts", to: "ts:b.ts", type: "depends-on" });
  });

  it("skips external and unresolved imports", () => {
    const project = projectWith({
      "a.ts": `import * as fs from "node:fs";\nimport { x } from "./missing";`,
    });
    expect(resolveImportEdges(project, "/")).toEqual([]);
  });

  it("resolves nested relative imports across directories", () => {
    const project = projectWith({
      "src/index.ts": `import { q } from "./queue/queue";`,
      "src/queue/queue.ts": `export const q = 1;`,
    });
    const edges = resolveImportEdges(project, "/");
    expect(edges).toContainEqual({
      from: "ts:src/index.ts",
      to: "ts:src/queue/queue.ts",
      type: "depends-on",
    });
  });

  it("emits nothing for a file with no imports", () => {
    expect(resolveImportEdges(projectWith({ "solo.ts": `export const x = 1;` }), "/")).toEqual([]);
  });
});
