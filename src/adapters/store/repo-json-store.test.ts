import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { repoJsonStore, writeJsonSync, readTextSync, type JsonSetSpec } from "./repo-json-store.js";

const made: string[] = [];
function tmpFile(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-store-"));
  made.push(dir);
  return path.join(dir, name);
}
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

// A minimal synthetic set type so the factory mechanics are tested independent of
// any concrete store (diagram/doc/overlay each thread real core ops into this).
interface Item {
  readonly id: string;
  readonly v: number;
}
interface ItemSet {
  readonly items: readonly Item[];
}
const spec: JsonSetSpec<ItemSet, Item> = {
  parse: (text) => {
    try {
      return { ok: true, set: JSON.parse(text) as ItemSet };
    } catch {
      return { ok: false };
    }
  },
  empty: () => ({ items: [] }),
  upsert: (set, item) => {
    const items = set.items.some((x) => x.id === item.id)
      ? set.items.map((x) => (x.id === item.id ? item : x))
      : [...set.items, item];
    return { items };
  },
  removeFrom: (set, id) => ({ items: set.items.filter((x) => x.id !== id) }),
  items: (set) => set.items,
};

describe("repoJsonStore (FR-44 shared set-store factory)", () => {
  it("a missing file loads as the empty set", async () => {
    const store = repoJsonStore(tmpFile("nope.json"), spec);
    expect((await store.all()).items).toEqual([]);
  });

  it("saves, then reads back through a FRESH instance (disk round-trip)", async () => {
    const file = tmpFile("set.json");
    await repoJsonStore(file, spec).save({ id: "a", v: 1 });
    const reloaded = await repoJsonStore(file, spec).all();
    expect(reloaded.items).toEqual([{ id: "a", v: 1 }]);
  });

  it("upserts by id — re-saving the same id replaces, never duplicates", async () => {
    const store = repoJsonStore(tmpFile("set.json"), spec);
    await store.save({ id: "a", v: 1 });
    await store.save({ id: "a", v: 2 });
    expect((await store.all()).items).toEqual([{ id: "a", v: 2 }]);
  });

  it("removes by id and reports whether it existed", async () => {
    const store = repoJsonStore(tmpFile("set.json"), spec);
    await store.save({ id: "a", v: 1 });
    expect(await store.remove("a")).toBe(true);
    expect(await store.remove("a")).toBe(false);
    expect((await store.all()).items).toEqual([]);
  });

  it("degrades to empty on a corrupt file, and can still save over it", async () => {
    const file = tmpFile("bad.json");
    fs.writeFileSync(file, "{ not json");
    const store = repoJsonStore(file, spec);
    expect((await store.all()).items).toEqual([]);
    await store.save({ id: "a", v: 1 });
    expect((await store.all()).items).toEqual([{ id: "a", v: 1 }]);
  });
});

describe("writeJsonSync / readTextSync", () => {
  it("creates parent dirs and writes pretty JSON that reads back", () => {
    const file = path.join(tmpFile("x.json"), "..", "nested", "deep", "data.json");
    writeJsonSync(file, { hello: "world" });
    expect(readTextSync(file)).toBe('{\n  "hello": "world"\n}');
  });

  it("swallows write errors instead of throwing (unwritable path)", () => {
    // A path whose parent is an existing FILE can't be mkdir'd → write fails silently.
    const fileAsDir = tmpFile("blocker.json");
    fs.writeFileSync(fileAsDir, "x");
    expect(() => writeJsonSync(path.join(fileAsDir, "child.json"), { a: 1 })).not.toThrow();
  });

  it("returns undefined for an unreadable/missing file", () => {
    expect(readTextSync(tmpFile("ghost.json"))).toBeUndefined();
  });
});
