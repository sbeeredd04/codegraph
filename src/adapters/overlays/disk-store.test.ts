import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { diskOverlayStore } from "./disk-store.js";
import { validateNote, validateMark, type Overlay } from "../../core/overlays/overlay.js";

const made: string[] = [];
function tmpFile(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-overlays-"));
  made.push(dir);
  return path.join(dir, name);
}
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const noteOn = (address: string, body = "a note."): Overlay => {
  const r = validateNote({ anchor: { on: "node", address }, body });
  if (!r.ok) throw new Error(r.error);
  return r.overlay;
};
const markOn = (address: string, mark = "bug"): Overlay => {
  const r = validateMark({ address, mark });
  if (!r.ok) throw new Error(r.error);
  return r.overlay;
};

describe("diskOverlayStore", () => {
  it("saves and reads back an overlay set", async () => {
    const store = diskOverlayStore(tmpFile("overlays.json"));
    await store.save(noteOn("ts:a.ts#f"));
    const set = await store.all();
    expect(set.overlays).toHaveLength(1);
    expect(set.overlays[0]).toMatchObject({ kind: "note", body: "a note." });
  });

  it("upserts by id (re-saving the same anchor replaces, not duplicates)", async () => {
    const store = diskOverlayStore(tmpFile("overlays.json"));
    await store.save(noteOn("ts:a.ts#f", "first"));
    await store.save(noteOn("ts:a.ts#f", "rewritten"));
    const set = await store.all();
    expect(set.overlays).toHaveLength(1);
    expect((set.overlays[0] as { body: string }).body).toBe("rewritten");
  });

  it("holds distinct kinds on one node (a note and a mark coexist)", async () => {
    const store = diskOverlayStore(tmpFile("overlays.json"));
    await store.save(noteOn("ts:a.ts#f"));
    await store.save(markOn("ts:a.ts#f"));
    expect((await store.all()).overlays).toHaveLength(2);
  });

  it("removes by id and reports whether it existed", async () => {
    const store = diskOverlayStore(tmpFile("overlays.json"));
    const o = noteOn("ts:a.ts#f");
    await store.save(o);
    expect(await store.remove(o.id)).toBe(true);
    expect(await store.remove(o.id)).toBe(false);
    expect((await store.all()).overlays).toHaveLength(0);
  });

  it("persists across instances (the writer and a fresh reader meet at the file)", async () => {
    const file = tmpFile("overlays.json");
    await diskOverlayStore(file).save(markOn("ts:a.ts#f", "hotspot"));
    const set = await diskOverlayStore(file).all();
    expect(set.overlays[0]).toMatchObject({ kind: "mark", mark: "hotspot" });
  });

  it("degrades to empty on a missing or corrupt file rather than throwing", async () => {
    expect((await diskOverlayStore(tmpFile("nope.json")).all()).overlays).toEqual([]);
    const file = tmpFile("bad.json");
    fs.writeFileSync(file, "{ not json");
    const store = diskOverlayStore(file);
    expect((await store.all()).overlays).toEqual([]);
    // and it can still save over a corrupt file
    await store.save(noteOn("ts:a.ts#f"));
    expect((await store.all()).overlays).toHaveLength(1);
  });
});
