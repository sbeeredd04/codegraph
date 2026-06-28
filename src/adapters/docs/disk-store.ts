// Disk-backed doc store (Epic 7 / FR-29 companion to the diagram store): the
// on-disk half of the agent-authored docs loop. Implements the core DocStore port
// by persisting a versioned DocSet as JSON, loaded lazily and written through on
// every change. Loads tolerantly via parseDocSet (malformed entries dropped), and
// is crash-proof: a missing, corrupt, or read-only file degrades to an in-memory
// set rather than breaking the tools (local-first, graceful — AD-1 keeps this I/O
// out of core). The Markdown it stores is agent-written and UNTRUSTED; it is
// length-capped by validateDoc on write and sanitized at the render edge.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  emptyDocSet,
  parseDocSet,
  upsertDoc,
  removeDoc,
  type Doc,
  type DocSet,
  type DocStore,
} from "../../core/docs/doc.js";

/** A doc store persisted at `filePath`. The set is loaded once on first access
 * and held in memory; each change writes the whole set back through. All disk
 * failures are swallowed so the store always works as at least in-memory. */
export function diskDocStore(filePath: string): DocStore {
  let set: DocSet | undefined;

  const load = (): DocSet => {
    if (set) return set;
    try {
      const parsed = parseDocSet(fs.readFileSync(filePath, "utf8"));
      set = parsed.ok ? parsed.set : emptyDocSet();
    } catch {
      set = emptyDocSet(); // missing file
    }
    return set;
  };

  const persist = (next: DocSet): void => {
    set = next;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(next, null, 2));
    } catch {
      // read-only FS or similar → stay in-memory only
    }
  };

  return {
    all: () => Promise.resolve(load()),
    save: (doc: Doc) => {
      persist(upsertDoc(load(), doc));
      return Promise.resolve();
    },
    remove: (id: string) => {
      const before = load();
      const had = before.docs.some((d) => d.id === id);
      if (had) persist(removeDoc(before, id));
      return Promise.resolve(had);
    },
  };
}
