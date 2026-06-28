import { describe, it, expect } from "vitest";
import { lift3d, project3d, nearestNode, type LiftInput } from "./layout3d.js";

const NODES: LiftInput[] = [
  { id: "m", kind: "module", x: -10, y: 0 },
  { id: "c", kind: "class", x: 0, y: 0 },
  { id: "fn", kind: "function", x: 10, y: 0 },
  { id: "me", kind: "method", x: 0, y: 10 },
];

describe("lift3d — 2D layout to a 3D box", () => {
  it("preserves x/y and lifts z by kind band (modules back, methods front)", () => {
    const lifted = lift3d(NODES);
    const m = lifted.get("m")!;
    const me = lifted.get("me")!;
    expect(m.x).toBe(-10);
    expect(m.y).toBe(0);
    // module sits behind (more negative z) than method.
    expect(m.z).toBeLessThan(me.z);
  });

  it("is deterministic — identical input yields identical z (resume-safe)", () => {
    const a = lift3d(NODES).get("c")!;
    const b = lift3d(NODES).get("c")!;
    expect(a.z).toBe(b.z);
  });

  it("scales depth with the layout span, and is empty for no nodes", () => {
    const wide = lift3d([
      { id: "a", kind: "module", x: -100, y: 0 },
      { id: "b", kind: "method", x: 100, y: 0 },
    ]);
    const narrow = lift3d([
      { id: "a", kind: "module", x: -1, y: 0 },
      { id: "b", kind: "method", x: 1, y: 0 },
    ]);
    // A wider plane gets a deeper box, so its z extent is larger.
    expect(Math.abs(wide.get("a")!.z)).toBeGreaterThan(Math.abs(narrow.get("a")!.z));
    expect(lift3d([]).size).toBe(0);
  });
});

describe("project3d — orthographic yaw/pitch projection", () => {
  it("is identity at yaw=0, pitch=0 (depth carries z)", () => {
    const pr = project3d({ x: 3, y: 5, z: 7 }, 0, 0);
    expect(pr.x).toBeCloseTo(3);
    expect(pr.y).toBeCloseTo(5);
    expect(pr.depth).toBeCloseTo(7);
  });

  it("a quarter yaw rotates the x axis into depth", () => {
    // (x=2,y=0,z=0) rotated 90° about Y projects onto the plane origin, depth -2.
    const pr = project3d({ x: 2, y: 0, z: 0 }, Math.PI / 2, 0);
    expect(pr.x).toBeCloseTo(0);
    expect(pr.y).toBeCloseTo(0);
    expect(pr.depth).toBeCloseTo(-2);
  });

  it("pitch tilts the y axis into depth", () => {
    const pr = project3d({ x: 0, y: 2, z: 0 }, 0, Math.PI / 2);
    expect(pr.y).toBeCloseTo(0);
    expect(pr.depth).toBeCloseTo(2);
  });
});

describe("nearestNode — hit-testing in projected space", () => {
  const pts = [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 100, y: 0 },
  ];

  it("returns the closest node within range", () => {
    expect(nearestNode(pts, 5, 0, 20)).toBe("a");
    expect(nearestNode(pts, 95, 0, 20)).toBe("b");
  });

  it("returns null when the pointer is out of range of every node", () => {
    expect(nearestNode(pts, 50, 0, 20)).toBeNull();
  });

  it("breaks ties toward the later (nearer-to-camera) candidate", () => {
    const tie = [
      { id: "far", x: 0, y: 0 },
      { id: "near", x: 0, y: 0 },
    ];
    expect(nearestNode(tie, 0, 0, 10)).toBe("near");
  });
});
