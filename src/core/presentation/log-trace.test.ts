import { describe, it, expect } from "vitest";
import { parseStackTrace, mapTraceToAddresses, traceToAddresses } from "./log-trace.js";
import type { GraphNode } from "../graph/types.js";

const node = (address: string, line: number, file: string, kind: GraphNode["kind"] = "function"): GraphNode => ({
  address,
  kind,
  name: address.split(/[#.]/).pop() as string,
  location: { file, line, character: 0 },
});

// A small two-file fixture. location.line is 0-based (AD-10); stack traces are 1-based.
const NODES: GraphNode[] = [
  node("ts:src/auth.ts", 0, "src/auth.ts", "module"),
  node("ts:src/auth.ts#login", 10, "src/auth.ts"),
  node("ts:src/auth.ts#validate", 25, "src/auth.ts"),
  node("ts:src/db.ts", 0, "src/db.ts", "module"),
  node("ts:src/db.ts#write", 5, "src/db.ts"),
];

describe("parseStackTrace (FR-41)", () => {
  it("extracts V8/Node frames — parenthesised and anonymous", () => {
    const trace = [
      "Error: boom",
      "    at validate (/proj/src/auth.ts:27:9)",
      "    at /proj/src/db.ts:9:2",
    ].join("\n");
    expect(parseStackTrace(trace)).toEqual([
      { file: "/proj/src/auth.ts", line: 27 },
      { file: "/proj/src/db.ts", line: 9 },
    ]);
  });

  it("extracts Python frames", () => {
    const trace = [
      "Traceback (most recent call last):",
      '  File "src/app/main.py", line 42, in run',
      '  File "src/app/db.py", line 7, in write',
    ].join("\n");
    expect(parseStackTrace(trace)).toEqual([
      { file: "src/app/main.py", line: 42 },
      { file: "src/app/db.py", line: 7 },
    ]);
  });

  it("extracts Firefox @url frames and strips the scheme/authority", () => {
    const trace = ["login@http://localhost:3000/src/auth.js:13:5", "@http://localhost:3000/src/main.js:1:1"].join("\n");
    expect(parseStackTrace(trace)).toEqual([
      { file: "/src/auth.js", line: 13 },
      { file: "/src/main.js", line: 1 },
    ]);
  });

  it("skips lines that match no frame pattern (tolerant)", () => {
    const trace = ["just some prose", "TypeError: x is not a function", "    at foo (/a/b.ts:3:1)", ""].join("\n");
    expect(parseStackTrace(trace)).toEqual([{ file: "/a/b.ts", line: 3 }]);
  });

  it("returns [] for empty / non-string input", () => {
    expect(parseStackTrace("")).toEqual([]);
    expect(parseStackTrace(undefined)).toEqual([]);
    expect(parseStackTrace(null)).toEqual([]);
    expect(parseStackTrace(42)).toEqual([]);
  });

  it("caps the number of frames against a pathological paste", () => {
    const huge = Array.from({ length: 1000 }, (_, i) => `    at f (/a/b.ts:${i + 1}:1)`).join("\n");
    expect(parseStackTrace(huge).length).toBeLessThanOrEqual(200);
  });
});

describe("mapTraceToAddresses (FR-41 — nearest enclosing def)", () => {
  it("maps each frame to the nearest preceding definition in its file", () => {
    const frames = [
      { file: "/proj/src/auth.ts", line: 27 }, // -> validate (def at 0-based 25)
      { file: "/proj/src/auth.ts", line: 13 }, // -> login (def at 0-based 10)
      { file: "/proj/src/db.ts", line: 9 }, // -> write (def at 0-based 5)
    ];
    expect(mapTraceToAddresses(frames, NODES)).toEqual([
      "ts:src/auth.ts#validate",
      "ts:src/auth.ts#login",
      "ts:src/db.ts#write",
    ]);
  });

  it("falls back to the file's first node when the frame is above any def", () => {
    expect(mapTraceToAddresses([{ file: "/proj/src/auth.ts", line: 2 }], NODES)).toEqual(["ts:src/auth.ts"]);
  });

  it("drops frames whose file matches no node (graceful degrade)", () => {
    const frames = [
      { file: "/proj/node_modules/dep/index.js", line: 9 },
      { file: "/proj/src/auth.ts", line: 13 },
    ];
    expect(mapTraceToAddresses(frames, NODES)).toEqual(["ts:src/auth.ts#login"]);
  });

  it("collapses consecutive duplicate addresses (recursion / multi-line frames)", () => {
    const frames = [
      { file: "/proj/src/auth.ts", line: 13 },
      { file: "/proj/src/auth.ts", line: 15 }, // still inside login
      { file: "/proj/src/auth.ts", line: 27 }, // now validate
    ];
    expect(mapTraceToAddresses(frames, NODES)).toEqual(["ts:src/auth.ts#login", "ts:src/auth.ts#validate"]);
  });

  it("prefers the longest path-suffix match when files are ambiguous", () => {
    const nodes: GraphNode[] = [node("ts:util.ts#a", 0, "util.ts"), node("ts:src/util.ts#b", 0, "src/util.ts")];
    expect(mapTraceToAddresses([{ file: "/x/src/util.ts", line: 4 }], nodes)).toEqual(["ts:src/util.ts#b"]);
  });

  it("returns [] for empty frames or empty graph", () => {
    expect(mapTraceToAddresses([], NODES)).toEqual([]);
    expect(mapTraceToAddresses([{ file: "/a.ts", line: 1 }], [])).toEqual([]);
  });
});

describe("traceToAddresses (FR-41 end-to-end)", () => {
  it("walks a full Node trace into an ordered guided tour", () => {
    const trace = [
      "Error: kaboom",
      "    at validate (/proj/src/auth.ts:27:9)",
      "    at login (/proj/src/auth.ts:13:5)",
      "    at /proj/src/db.ts:9:2",
    ].join("\n");
    expect(traceToAddresses(trace, NODES)).toEqual([
      "ts:src/auth.ts#validate",
      "ts:src/auth.ts#login",
      "ts:src/db.ts#write",
    ]);
  });
});
