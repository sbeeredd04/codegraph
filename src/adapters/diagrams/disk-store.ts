// Disk-backed diagram store (Epic 7): the on-disk half of the agent-authored
// diagram loop. Implements the core DiagramStore port by persisting a versioned
// DiagramSet as JSON, loaded lazily and written through on every change. The
// lazy-load + crash-proof write-through machinery lives in the shared
// repoJsonStore factory (FR-44) — here we just thread the diagram set's pure
// operations. Loads tolerantly via parseDiagramSet (malformed entries dropped),
// and degrades to an in-memory set on a missing/corrupt/read-only file rather than
// breaking the tools (local-first, graceful — AD-1 keeps this I/O out of core).

import {
  emptyDiagramSet,
  parseDiagramSet,
  upsertDiagram,
  removeDiagram,
  type DiagramStore,
} from "../../core/diagrams/diagram.js";
import { repoJsonStore } from "../store/repo-json-store.js";

/** A diagram store persisted at `filePath`. The set is loaded once on first
 * access and held in memory; each change writes the whole set back through. All
 * disk failures are swallowed so the store always works as at least in-memory. */
export function diskDiagramStore(filePath: string): DiagramStore {
  return repoJsonStore(filePath, {
    parse: parseDiagramSet,
    empty: emptyDiagramSet,
    upsert: upsertDiagram,
    removeFrom: removeDiagram,
    items: (set) => set.diagrams,
  });
}
