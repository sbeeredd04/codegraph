import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { diskCommandSink, readCommandsFrom } from "./disk-sink.js";
import type { PresentationCommand } from "../../core/presentation/command.js";

const made: string[] = [];
function tmpFile(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-present-"));
  made.push(dir);
  return path.join(dir, name);
}
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const HL: PresentationCommand = { kind: "highlight_nodes", addresses: ["ts:a.ts#f"] };
const FOCUS: PresentationCommand = { kind: "focus_camera", addresses: ["ts:b.ts#g"], select: false };
const PROJ: PresentationCommand = { kind: "set_projection", projection: "dependency" };

describe("diskCommandSink + readCommandsFrom (the FR-39 command bus)", () => {
  it("emits commands the panel drains in order from an offset", async () => {
    const file = tmpFile("present.jsonl");
    const sink = diskCommandSink(file);
    await sink.emit(HL);
    await sink.emit(FOCUS);

    const first = readCommandsFrom(file, 0);
    expect(first.commands).toEqual([HL, FOCUS]);
    expect(first.offset).toBe(fs.statSync(file).size);

    // A subsequent drain from the advanced offset returns only the new command.
    await sink.emit(PROJ);
    const next = readCommandsFrom(file, first.offset);
    expect(next.commands).toEqual([PROJ]);
    expect(next.offset).toBe(fs.statSync(file).size);
  });

  it("seeding the offset at end-of-file skips the backlog (only live directives forward)", async () => {
    const file = tmpFile("present.jsonl");
    const sink = diskCommandSink(file);
    await sink.emit(HL); // backlog written before the board opened
    const start = fs.statSync(file).size;

    // The panel opens and seeds its offset at the current size — backlog ignored.
    expect(readCommandsFrom(file, start).commands).toEqual([]);
    await sink.emit(FOCUS);
    expect(readCommandsFrom(file, start).commands).toEqual([FOCUS]);
  });

  it("re-validates each line through the core codec, dropping malformed directives", async () => {
    const file = tmpFile("present.jsonl");
    // Hand-write a mix: a valid command, an unknown-kind object, a torn JSON line.
    fs.writeFileSync(
      file,
      `${JSON.stringify(HL)}\n${JSON.stringify({ kind: "obliterate" })}\n{ not json\n${JSON.stringify(PROJ)}\n`,
    );
    const drained = readCommandsFrom(file, 0);
    expect(drained.commands).toEqual([HL, PROJ]);
  });

  it("leaves a partial trailing line unconsumed until it completes", async () => {
    const file = tmpFile("present.jsonl");
    // A whole line followed by a half-written one (an emit mid-flight).
    fs.writeFileSync(file, `${JSON.stringify(HL)}\n${JSON.stringify(FOCUS).slice(0, 10)}`);
    const first = readCommandsFrom(file, 0);
    expect(first.commands).toEqual([HL]);
    // The offset stops at the newline, so the partial line is re-read once whole.
    fs.appendFileSync(file, `${JSON.stringify(FOCUS).slice(10)}\n`);
    expect(readCommandsFrom(file, first.offset).commands).toEqual([FOCUS]);
  });

  it("restarts from the top when the queue is truncated under the reader", () => {
    const file = tmpFile("present.jsonl");
    fs.writeFileSync(file, `${JSON.stringify(HL)}\n${JSON.stringify(FOCUS)}\n`);
    const big = fs.statSync(file).size;
    // The queue is rotated/truncated to a single new command behind the stale offset.
    fs.writeFileSync(file, `${JSON.stringify(PROJ)}\n`);
    expect(readCommandsFrom(file, big).commands).toEqual([PROJ]);
  });

  it("emit never throws and a drain over a missing file yields nothing", async () => {
    const missing = tmpFile("nope.jsonl");
    expect(readCommandsFrom(missing, 0)).toEqual({ commands: [], offset: 0 });
    // Emitting creates the file; no throw even though the dir was just made.
    await diskCommandSink(missing).emit(HL);
    expect(readCommandsFrom(missing, 0).commands).toEqual([HL]);
  });
});
