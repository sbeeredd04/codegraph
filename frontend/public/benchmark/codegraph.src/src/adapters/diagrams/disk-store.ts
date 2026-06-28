// Disk-backed diagram store (Epic 7): the on-disk half of the agent-authored
// diagram loop. Implements the core DiagramStore port by persisting a versioned
// DiagramSet as JSON, loaded lazily and written through on every change. Loads
// tolerantly via parseDiagramSet (malformed entries dropped), and is crash-proof:
// a missing, corrupt, or read-only file degrades to an in-memory set rather than
// breaking the tools (local-first, graceful — AD-1 keeps this I/O out of core).

import * as fs from "node:fs";
import * as path from "node:path";
import {
  emptyDiagramSet,
  parseDiagramSet,
  upsertDiagram,
  removeDiagram,
  type Diagram,
  type DiagramSet,
  type DiagramStore,
} from "../../core/diagrams/diagram.js";

/** A diagram store persisted at `filePath`. The set is loaded once on first
 * access and held in memory; each change writes the whole set back through. All
 * disk failures are swallowed so the store always works as at least in-memory. */
export function diskDiagramStore(filePath: string): DiagramStore {
  let set: DiagramSet | undefined;

  const load = (): DiagramSet => {
    if (set) return set;
    try {
      const parsed = parseDiagramSet(fs.readFileSync(filePath, "utf8"));
      set = parsed.ok ? parsed.set : emptyDiagramSet();
    } catch {
      set = emptyDiagramSet(); // missing file
    }
    return set;
  };

  const persist = (next: DiagramSet): void => {
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
    save: (diagram: Diagram) => {
      persist(upsertDiagram(load(), diagram));
      return Promise.resolve();
    },
    remove: (id: string) => {
      const before = load();
      const had = before.diagrams.some((d) => d.id === id);
      if (had) persist(removeDiagram(before, id));
      return Promise.resolve(had);
    },
  };
}
