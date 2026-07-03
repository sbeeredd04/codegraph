import { describe, it, expect } from "vitest";
import { describeEdgeCall } from "./edge-call.js";
import type { GraphEdge, GraphNode } from "./types.js";

const node = (address: string, kind: GraphNode["kind"]): GraphNode => ({
  address,
  kind,
  name: address.split("#").pop() ?? address,
  location: { file: "a.ts", line: 0, character: 0 },
});

const edge = (type: GraphEdge["type"], call?: GraphEdge["call"]): GraphEdge => ({
  from: "a",
  to: "b",
  type,
  ...(call ? { call } : {}),
});

describe("describeEdgeCall", () => {
  it("classifies a `calls` edge into a class as a construction", () => {
    const c = describeEdgeCall(edge("calls"), node("b", "class"));
    expect(c.kind).toBe("construct");
    expect(c.label).toBe("constructs");
    expect(c.inverseLabel).toBe("constructed by");
  });

  it("classifies a `calls` edge into a method as a method call", () => {
    const c = describeEdgeCall(edge("calls"), node("b", "method"));
    expect(c.kind).toBe("method-call");
    expect(c.label).toBe("calls method");
  });

  it("classifies a `calls` edge into a function as a plain call", () => {
    const c = describeEdgeCall(edge("calls"), node("b", "function"));
    expect(c.kind).toBe("call");
    expect(c.label).toBe("calls");
  });

  it("classifies a `depends-on` edge into a module as an import", () => {
    const c = describeEdgeCall(edge("depends-on"), node("b", "module"));
    expect(c.kind).toBe("import");
    expect(c.label).toBe("imports");
  });

  it("classifies a `depends-on` edge into a non-module as a plain dependency", () => {
    const c = describeEdgeCall(edge("depends-on"), node("b", "function"));
    expect(c.kind).toBe("depend");
    expect(c.label).toBe("depends on");
  });

  it("maps `contains` and `hands-off-to` to their structural / workflow kinds", () => {
    expect(describeEdgeCall(edge("contains"), node("b", "class")).kind).toBe("contain");
    expect(describeEdgeCall(edge("hands-off-to"), node("b", "workflow")).kind).toBe("handoff");
    expect(describeEdgeCall(edge("hands-off-to")).inverseLabel).toBe("receives from");
  });

  it("degrades gracefully to a type-only classification when the target node is unknown", () => {
    // No toNode: a `calls` edge can't be refined to construct/method, so it's a plain call.
    expect(describeEdgeCall(edge("calls")).kind).toBe("call");
    expect(describeEdgeCall(edge("depends-on")).kind).toBe("depend");
  });

  it("labels a JSX render edge via the explicit `render` sub-kind (FR-84)", () => {
    // A render edge stays `type: "calls"` (JSX compiles to React.createElement) but
    // pins `call: "render"` so the surface says "renders" instead of "calls".
    const c = describeEdgeCall(edge("calls", "render"), node("b", "function"));
    expect(c.kind).toBe("render");
    expect(c.label).toBe("renders");
    expect(c.inverseLabel).toBe("rendered by");
  });

  it("honors an explicit `edge.call` override even against the derived kind", () => {
    // The edge points at a function (would derive `call`), but the indexer pinned `construct`.
    const c = describeEdgeCall(edge("calls", "construct"), node("b", "function"));
    expect(c.kind).toBe("construct");
    expect(c.label).toBe("constructs");
  });

  it("gives every kind a non-empty label, inverse label, and description", () => {
    const samples: GraphEdge[] = [
      edge("calls", "construct"),
      edge("calls", "method-call"),
      edge("calls", "call"),
      edge("depends-on", "import"),
      edge("depends-on", "depend"),
      edge("contains", "contain"),
      edge("hands-off-to", "handoff"),
      edge("calls", "render"),
    ];
    for (const e of samples) {
      const c = describeEdgeCall(e);
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.inverseLabel.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });
});
