import { describe, it, expect } from "vitest";
import { detectEntryPoints } from "./entry-point.js";
import type { GraphEdge, GraphNode } from "./types.js";

const mod = (file: string): GraphNode => ({
  address: `m:${file}`,
  kind: "module",
  name: file.split("/").pop() ?? file,
  location: { file, line: 0, character: 0 },
});

const fn = (name: string): GraphNode => ({
  address: `fn:${name}`,
  kind: "function",
  name,
  location: { file: "a.ts", line: 1, character: 0 },
});

const dep = (from: string, to: string): GraphEdge => ({ from, to, type: "depends-on" });

describe("detectEntryPoints", () => {
  it("flags a conventional entry filename with its reason", () => {
    const eps = detectEntryPoints([mod("src/main.ts"), mod("src/util.ts")], []);
    expect(eps.map((e) => e.address)).toEqual(["m:src/main.ts"]);
    expect(eps[0].reason).toContain("main.ts");
  });

  it("ranks Python __main__ above app.py and ranks by score", () => {
    const eps = detectEntryPoints([mod("pkg/app.py"), mod("pkg/__main__.py")], []);
    expect(eps.map((e) => e.address)).toEqual(["m:pkg/__main__.py", "m:pkg/app.py"]);
    expect(eps[0].score).toBeGreaterThan(eps[1].score);
  });

  it("boosts an entry file that is also a dependency root (nothing imports it)", () => {
    // main.ts imports three modules and is imported by none → root boost.
    const nodes = [mod("src/main.ts"), mod("src/a.ts"), mod("src/b.ts"), mod("src/c.ts")];
    const edges = [
      dep("m:src/main.ts", "m:src/a.ts"),
      dep("m:src/main.ts", "m:src/b.ts"),
      dep("m:src/main.ts", "m:src/c.ts"),
    ];
    const eps = detectEntryPoints(nodes, edges);
    const main = eps.find((e) => e.address === "m:src/main.ts");
    expect(main?.score).toBe(100); // 94 + 6
    expect(main?.reason).toContain("no inbound imports");
  });

  it("demotes a conventionally-named file that is imported by others", () => {
    // An index.ts that something imports is more likely a barrel than the entry.
    const nodes = [mod("src/index.ts"), mod("src/consumer.ts")];
    const edges = [dep("m:src/consumer.ts", "m:src/index.ts")];
    const eps = detectEntryPoints(nodes, edges);
    // 64 - 20 = 44, still above threshold but clearly demoted.
    expect(eps.find((e) => e.address === "m:src/index.ts")?.score).toBe(44);
  });

  it("detects a pure dependency root with no conventional name", () => {
    const nodes = [mod("src/boot.ts"), mod("src/x.ts"), mod("src/y.ts"), mod("src/z.ts")];
    const edges = [
      dep("m:src/boot.ts", "m:src/x.ts"),
      dep("m:src/boot.ts", "m:src/y.ts"),
      dep("m:src/boot.ts", "m:src/z.ts"),
    ];
    const eps = detectEntryPoints(nodes, edges);
    const boot = eps.find((e) => e.address === "m:src/boot.ts");
    expect(boot?.score).toBe(40);
    expect(boot?.reason).toBe("no inbound imports");
  });

  it("flags a function literally named `main`", () => {
    const eps = detectEntryPoints([fn("main"), fn("helper")], []);
    expect(eps.map((e) => e.address)).toEqual(["fn:main"]);
    expect(eps[0].reason).toBe("main function");
  });

  it("returns nothing for an ordinary graph with no entry signals", () => {
    const nodes = [mod("src/widgets.ts"), mod("src/styles.ts")];
    // widgets imports styles, so neither is a root; neither name is conventional.
    const eps = detectEntryPoints(nodes, [dep("m:src/widgets.ts", "m:src/styles.ts")]);
    expect(eps).toEqual([]);
  });

  it("matches the basename regardless of nested directories or leading paths", () => {
    const eps = detectEntryPoints([mod("apps/server/src/main.py")], []);
    expect(eps[0]?.address).toBe("m:apps/server/src/main.py");
  });
});
