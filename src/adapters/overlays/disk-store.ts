// Disk-backed overlay store (Epic 19 / FR-37 companion to the doc + diagram
// stores): the on-disk half of the agent-authored overlay loop. Implements the
// core OverlayStore port by persisting a versioned OverlaySet as JSON, loaded
// lazily and written through on every change — the shared repoJsonStore factory
// (FR-44) carries the lazy-load + crash-proof write-through; here we thread the
// overlay set's pure operations. Loads tolerantly via parseOverlaySet (malformed
// entries dropped), and degrades to an in-memory set on a missing/corrupt/read-only
// file rather than breaking the tools (local-first, graceful — AD-1 keeps this I/O
// out of core). The notes, marks, and groups it stores are agent-written and
// UNTRUSTED; they are length-capped by validateNote/Mark/Group on write and escaped
// at the render edge.

import {
  emptyOverlaySet,
  parseOverlaySet,
  upsertOverlay,
  removeOverlay,
  type OverlayStore,
} from "../../core/overlays/overlay.js";
import { repoJsonStore } from "../store/repo-json-store.js";

/** An overlay store persisted at `filePath`. The set is loaded once on first
 * access and held in memory; each change writes the whole set back through. All
 * disk failures are swallowed so the store always works as at least in-memory. */
export function diskOverlayStore(filePath: string): OverlayStore {
  return repoJsonStore(filePath, {
    parse: parseOverlaySet,
    empty: emptyOverlaySet,
    upsert: upsertOverlay,
    removeFrom: removeOverlay,
    items: (set) => set.overlays,
  });
}
