import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { diskDocStore } from "./disk-store.js";
import { validateDoc, type Doc } from "../../core/docs/doc.js";

const made: string[] = [];
function tmpFile(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-docs-"));
  made.push(dir);
  return path.join(dir, name);
}
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const doc = (title: string, category = "guide"): Doc => {
  const r = validateDoc({ title, category, markdown: `# ${title}\n\nbody.` });
  if (!r.ok) throw new Error(r.error);
  return r.doc;
};

describe("diskDocStore", () => {
  it("saves and reads back a doc set", async () => {
    const store = diskDocStore(tmpFile("docs.json"));
    await store.save(doc("Getting started"));
    const set = await store.all();
    expect(set.docs).toHaveLength(1);
    expect(set.docs[0].title).toBe("Getting started");
  });

  it("upserts by id (re-saving the same title replaces, not duplicates)", async () => {
    const store = diskDocStore(tmpFile("docs.json"));
    await store.save(doc("Getting started"));
    await store.save({ ...doc("Getting started"), markdown: "# Getting started\n\nrewritten." });
    const set = await store.all();
    expect(set.docs).toHaveLength(1);
    expect(set.docs[0].markdown).toContain("rewritten");
  });

  it("removes by id and reports whether it existed", async () => {
    const store = diskDocStore(tmpFile("docs.json"));
    const d = doc("Getting started");
    await store.save(d);
    expect(await store.remove(d.id)).toBe(true);
    expect(await store.remove(d.id)).toBe(false);
    expect((await store.all()).docs).toHaveLength(0);
  });

  it("persists across instances (the writer and a fresh reader meet at the file)", async () => {
    const file = tmpFile("docs.json");
    await diskDocStore(file).save(doc("Architecture", "architecture"));
    const set = await diskDocStore(file).all();
    expect(set.docs[0].category).toBe("architecture");
  });

  it("degrades to empty on a missing or corrupt file rather than throwing", async () => {
    expect((await diskDocStore(tmpFile("nope.json")).all()).docs).toEqual([]);
    const file = tmpFile("bad.json");
    fs.writeFileSync(file, "{ not json");
    const store = diskDocStore(file);
    expect((await store.all()).docs).toEqual([]);
    // and it can still save over a corrupt file
    await store.save(doc("Recovered"));
    expect((await store.all()).docs).toHaveLength(1);
  });
});
