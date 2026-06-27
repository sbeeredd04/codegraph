import { describe, it, expect } from "vitest";
import { createCoalescer } from "./coalescer.js";

// A deterministic fake clock so the debounce window is testable without real time.
class FakeClock {
  now = 0;
  private seq = 0;
  private pending: { id: number; fn: () => void; at: number }[] = [];
  setTimer = (fn: () => void, ms: number): number => {
    const id = ++this.seq;
    this.pending.push({ id, fn, at: this.now + ms });
    return id;
  };
  clearTimer = (handle: unknown): void => {
    this.pending = this.pending.filter((t) => t.id !== handle);
  };
  advance(ms: number): void {
    this.now += ms;
    const due = this.pending.filter((t) => t.at <= this.now).sort((a, b) => a.at - b.at);
    this.pending = this.pending.filter((t) => t.at > this.now);
    for (const t of due) t.fn();
  }
}

describe("createCoalescer", () => {
  it("coalesces rapid notifications into a single flush", () => {
    const clock = new FakeClock();
    const flushes: string[][] = [];
    const c = createCoalescer(50, (paths) => flushes.push(paths), clock);
    c.notify("a.ts");
    c.notify("b.ts");
    c.notify("c.ts");
    expect(flushes).toHaveLength(0); // nothing yet — still inside the quiet window
    clock.advance(50);
    expect(flushes).toHaveLength(1);
    expect([...flushes[0]].sort()).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("resets the quiet window on each new notification", () => {
    const clock = new FakeClock();
    const flushes: string[][] = [];
    const c = createCoalescer(50, (paths) => flushes.push(paths), clock);
    c.notify("a.ts");
    clock.advance(40); // < window
    c.notify("b.ts"); // resets the timer
    clock.advance(40); // 80ms elapsed total, but only 40ms since last notify
    expect(flushes).toHaveLength(0);
    clock.advance(10); // now 50ms quiet since "b.ts"
    expect(flushes).toHaveLength(1);
    expect([...flushes[0]].sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("dedupes repeated paths within a burst", () => {
    const clock = new FakeClock();
    const flushes: string[][] = [];
    const c = createCoalescer(50, (paths) => flushes.push(paths), clock);
    c.notify("a.ts");
    c.notify("a.ts");
    clock.advance(50);
    expect(flushes[0]).toEqual(["a.ts"]);
  });

  it("starts a fresh batch after a flush", () => {
    const clock = new FakeClock();
    const flushes: string[][] = [];
    const c = createCoalescer(50, (paths) => flushes.push(paths), clock);
    c.notify("a.ts");
    clock.advance(50);
    c.notify("b.ts");
    clock.advance(50);
    expect(flushes).toHaveLength(2);
    expect(flushes[1]).toEqual(["b.ts"]);
  });

  it("dispose cancels a pending flush", () => {
    const clock = new FakeClock();
    const flushes: string[][] = [];
    const c = createCoalescer(50, (paths) => flushes.push(paths), clock);
    c.notify("a.ts");
    c.dispose();
    clock.advance(50);
    expect(flushes).toHaveLength(0);
  });
});
