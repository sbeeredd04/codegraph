// Disk-backed overlay store (Epic 19 / FR-37 companion to the doc + diagram
// stores): the on-disk half of the agent-authored overlay loop. Implements the
// core OverlayStore port by persisting a versioned OverlaySet as JSON, loaded
// lazily and written through on every change. Loads tolerantly via
// parseOverlaySet (malformed entries dropped), and is crash-proof: a missing,
// corrupt, or read-only file degrades to an in-memory set rather than breaking
// the tools (local-first, graceful — AD-1 keeps this I/O out of core). The notes,
// marks, and groups it stores are agent-written and UNTRUSTED; they are
// length-capped by validateNote/Mark/Group on write and escaped at the render edge.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  emptyOverlaySet,
  parseOverlaySet,
  upsertOverlay,
  removeOverlay,
  type Overlay,
  type OverlaySet,
  type OverlayStore,
} from "../../core/overlays/overlay.js";

/** An overlay store persisted at `filePath`. The set is loaded once on first
 * access and held in memory; each change writes the whole set back through. All
 * disk failures are swallowed so the store always works as at least in-memory. */
export function diskOverlayStore(filePath: string): OverlayStore {
  let set: OverlaySet | undefined;

  const load = (): OverlaySet => {
    if (set) return set;
    try {
      const parsed = parseOverlaySet(fs.readFileSync(filePath, "utf8"));
      set = parsed.ok ? parsed.set : emptyOverlaySet();
    } catch {
      set = emptyOverlaySet(); // missing file
    }
    return set;
  };

  const persist = (next: OverlaySet): void => {
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
    save: (overlay: Overlay) => {
      persist(upsertOverlay(load(), overlay));
      return Promise.resolve();
    },
    remove: (id: string) => {
      const before = load();
      const had = before.overlays.some((o) => o.id === id);
      if (had) persist(removeOverlay(before, id));
      return Promise.resolve(had);
    },
  };
}
