import { describe, it, expect } from "vitest";
import { injectSnapshot } from "./inject.js";
import type { GraphSnapshot } from "../../core/graph/export.js";

const HTML = "<html><head></head><body>board</body></html>";

function snapshot(name = "login"): GraphSnapshot {
  return {
    version: 1,
    nodeCount: 1,
    edgeCount: 0,
    nodes: [{ address: "ts:a.ts#login", kind: "function", name, location: { file: "a.ts", line: 0, character: 0 } }],
    edges: [],
  };
}

describe("injectSnapshot (FR-88)", () => {
  it("inserts the boot script right after <head>, before the app bundle", () => {
    const out = injectSnapshot(HTML, snapshot());
    expect(out.indexOf("<head>")).toBeLessThan(out.indexOf("acquireVsCodeApi"));
    expect(out).toContain("window.acquireVsCodeApi");
  });

  it("embeds the snapshot and delivers it on the board's ready ping", () => {
    const out = injectSnapshot(HTML, snapshot());
    expect(out).toContain('"codegraph:snapshot"');
    expect(out).toContain("ts:a.ts#login"); // the node address survives serialization
    expect(out).toContain("codegraph:ready"); // the handshake the host mirrors
  });

  it("includes editorRoot only when supplied (FR-32 deep links, local plane)", () => {
    expect(injectSnapshot(HTML, snapshot(), "/abs/repo")).toContain("/abs/repo");
    expect(injectSnapshot(HTML, snapshot())).not.toContain("editorRoot");
  });

  it("escapes </script> in node data so it cannot break out of the inline script", () => {
    const out = injectSnapshot(HTML, snapshot("</script><script>alert(1)</script>"));
    // The data's closing tag is escaped; only the boot script's own close remains.
    expect(out).toContain("\\u003c/script");
    expect(out).not.toContain("<script>alert(1)");
    expect(out.match(/<\/script>/g)?.length).toBe(1);
  });

  it("escapes U+2028/U+2029 so a line separator in data can't break the boot script (T11.3)", () => {
    const ls = String.fromCharCode(0x2028); // legal in JSON, a raw newline in a JS string
    const ps = String.fromCharCode(0x2029);
    const out = injectSnapshot(HTML, snapshot(`na${ls}me${ps}x`));
    expect(out).toContain("\\u2028"); // escaped in the emitted script
    expect(out).toContain("\\u2029");
    expect(out).not.toContain(ls); // no raw separator survives into the script text
    expect(out).not.toContain(ps);
  });

  it("falls back to prepending when there is no <head>", () => {
    const out = injectSnapshot("<body>x</body>", snapshot());
    expect(out.startsWith("<script>")).toBe(true);
  });
});
