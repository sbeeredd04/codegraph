import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { diskDiagramStore } from "./disk-store.js";
import { validateDiagram, type Diagram } from "../../core/diagrams/diagram.js";

const made: string[] = [];
function tmpFile(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-diagrams-"));
  made.push(dir);
  return path.join(dir, name);
}
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const diagram = (title: string, category = "workflow"): Diagram => {
  const r = validateDiagram({ title, category, mermaid: `flowchart TD\n A-->B` });
  if (!r.ok) throw new Error(r.error);
  return r.diagram;
};

describe("diskDiagramStore", () => {
  it("saves and reads back a diagram set", async () => {
    const store = diskDiagramStore(tmpFile("diagrams.json"));
    await store.save(diagram("Sign up"));
    const set = await store.all();
    expect(set.diagrams).toHaveLength(1);
    expect(set.diagrams[0].title).toBe("Sign up");
  });

  it("upserts by id (re-saving the same title replaces, not duplicates)", async () => {
    const store = diskDiagramStore(tmpFile("diagrams.json"));
    await store.save(diagram("Sign up"));
    await store.save({ ...diagram("Sign up"), mermaid: "flowchart TD\n X-->Y" });
    const set = await store.all();
    expect(set.diagrams).toHaveLength(1);
    expect(set.diagrams[0].mermaid).toContain("X-->Y");
  });

  it("removes by id and reports whether it existed", async () => {
    const store = diskDiagramStore(tmpFile("diagrams.json"));
    const d = diagram("Sign up");
    await store.save(d);
    expect(await store.remove(d.id)).toBe(true);
    expect(await store.remove(d.id)).toBe(false);
    expect((await store.all()).diagrams).toHaveLength(0);
  });

  it("persists across instances (the writer and a fresh reader meet at the file)", async () => {
    const file = tmpFile("diagrams.json");
    await diskDiagramStore(file).save(diagram("Architecture", "architecture"));
    const set = await diskDiagramStore(file).all();
    expect(set.diagrams[0].category).toBe("architecture");
  });

  it("degrades to empty on a missing or corrupt file rather than throwing", async () => {
    expect((await diskDiagramStore(tmpFile("nope.json")).all()).diagrams).toEqual([]);
    const file = tmpFile("bad.json");
    fs.writeFileSync(file, "{ not json");
    const store = diskDiagramStore(file);
    expect((await store.all()).diagrams).toEqual([]);
    // and it can still save over a corrupt file
    await store.save(diagram("Recovered"));
    expect((await store.all()).diagrams).toHaveLength(1);
  });
});
