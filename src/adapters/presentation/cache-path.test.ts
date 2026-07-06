import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { presentationCommandsPath } from "./cache-path.js";

// The presentation-command queue is the FR-39 seam that lets the user's agent DRIVE
// the board: the standalone MCP server APPENDS view directives to this path and the
// extension's ExplorerPanel TAILS the same file. The two run in SEPARATE processes and
// each compute the path from the repo root, so the feature only works if both land on
// the exact same file. The sibling overlaysCachePath has a dedicated test for this
// rendezvous; this pins the same contract for the transient command queue.
describe("presentationCommandsPath", () => {
  it("is deterministic for a root and independent of path spelling (the rendezvous)", () => {
    // The extension passes a folderPath and the MCP server passes its root; if one is
    // spelled with a trailing slash or a `.` segment they must still meet at one file.
    const a = presentationCommandsPath("/repo/app");
    const b = presentationCommandsPath("/repo/app/");
    const c = presentationCommandsPath("/repo/./app");
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a.endsWith(path.join("presentation-commands.jsonl"))).toBe(true);
  });

  it("differs by repo and honors a custom base dir", () => {
    expect(presentationCommandsPath("/repo/a")).not.toBe(presentationCommandsPath("/repo/b"));
    expect(presentationCommandsPath("/repo/a", "/base").startsWith("/base")).toBe(true);
  });

  it("is the TRANSIENT .jsonl stream, distinct from the durable knowledge caches", () => {
    // A .jsonl append stream (one command per line, drained by byte offset), never the
    // durable .json caches the agent's diagrams/docs/overlays persist to.
    const p = presentationCommandsPath("/repo/a", "/base");
    expect(p.endsWith(".jsonl")).toBe(true);
    for (const durable of ["overlays.json", "docs.json", "diagrams.json"]) {
      expect(p).not.toContain(durable);
    }
  });

  // The MCP SDK spawns the server with a stripped environment that drops TMPDIR, so a
  // tmpdir-anchored path would split the two processes onto different files. The path is
  // homedir-anchored precisely so the agent's writes still reach the board.
  it("is independent of TMPDIR so the agent's writes reach the board", () => {
    const saved = process.env.TMPDIR;
    try {
      process.env.TMPDIR = path.join(path.sep, "tmp", "one");
      const a = presentationCommandsPath("/repo/a");
      process.env.TMPDIR = path.join(path.sep, "var", "two");
      expect(presentationCommandsPath("/repo/a")).toBe(a);
    } finally {
      if (saved === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = saved;
    }
  });
});
