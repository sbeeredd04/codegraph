import { describe, it, expect } from "vitest";
import {
  GRAMMARS,
  EDGE_RESOLVERS,
  LANGUAGE_FAMILIES,
  enabledFamilies,
  grammarForFile,
  isSourceFile,
  type LanguageFamily,
} from "./registry.js";

const ALL = new Set<LanguageFamily>(LANGUAGE_FAMILIES);

describe("language registry (FR-86)", () => {
  it("dispatches each extension to the right grammar", () => {
    expect(grammarForFile("src/a.ts", ALL)?.id).toBe("typescript");
    // The JSX superset covers .tsx/.jsx and plain JS (which may embed JSX).
    for (const ext of [".tsx", ".jsx", ".js", ".mjs", ".cjs"]) {
      expect(grammarForFile(`src/App${ext}`, ALL)?.id).toBe("tsx");
    }
    expect(grammarForFile("app/main.py", ALL)?.id).toBe("python");
  });

  it("keeps plain .ts on the TypeScript grammar, not the tsx superset", () => {
    // `.tsx` does not end with `.ts`, so the two never collide.
    expect(grammarForFile("x.ts", ALL)?.family).toBe("typescript");
    expect(grammarForFile("x.tsx", ALL)?.id).toBe("tsx");
  });

  it("excludes declaration and test/spec files across the family", () => {
    for (const f of ["types.d.ts", "a.test.ts", "b.spec.tsx", "c.test.js", "d.spec.jsx"]) {
      expect(grammarForFile(f, ALL)).toBeUndefined();
      expect(isSourceFile(f, ALL)).toBe(false);
    }
  });

  it("returns nothing for an unregistered extension", () => {
    expect(grammarForFile("main.go", ALL)).toBeUndefined();
    expect(grammarForFile("a.rb", ALL)).toBeUndefined();
    expect(grammarForFile("README.md", ALL)).toBeUndefined();
  });

  it("honors the enabled families (a disabled family is invisible to the scan)", () => {
    const tsOnly = new Set<LanguageFamily>(["typescript"]);
    const pyOnly = new Set<LanguageFamily>(["python"]);
    expect(grammarForFile("a.py", tsOnly)).toBeUndefined();
    expect(grammarForFile("a.ts", tsOnly)?.id).toBe("typescript");
    expect(grammarForFile("a.ts", pyOnly)).toBeUndefined();
    expect(grammarForFile("a.py", pyOnly)?.id).toBe("python");
  });

  it("enabledFamilies defaults both on and drops a false-toggled family", () => {
    expect([...enabledFamilies({})].sort()).toEqual(["python", "typescript"]);
    expect([...enabledFamilies({ python: false })]).toEqual(["typescript"]);
    expect([...enabledFamilies({ typescript: false })]).toEqual(["python"]);
  });

  it("registers exactly one edge resolver per family, covering every grammar's family", () => {
    const resolverFamilies = EDGE_RESOLVERS.map((r) => r.family).sort();
    expect(resolverFamilies).toEqual([...LANGUAGE_FAMILIES].sort());
    // Every grammar's family has a resolver — no family can parse without edge support.
    for (const grammar of GRAMMARS) {
      expect(EDGE_RESOLVERS.some((r) => r.family === grammar.family)).toBe(true);
    }
  });
});
