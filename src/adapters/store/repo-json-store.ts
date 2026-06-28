// Shared disk-store mechanics (FR-44 dogfooding): the agent-authored knowledge
// stores — diagrams, docs, overlays — persist a versioned, id-keyed set as JSON
// and were three byte-identical copies of the same lazy-load + write-through
// machinery. This factory is the one copy: thread a store's pure set operations
// (parse / empty / upsert / remove / item list) and it returns the DiagramStore /
// DocStore / OverlayStore port, structurally. The enrichment cache shares the
// write primitive here but keeps its own Map-shaped { get, set } port (a different
// shape — not produced by this factory).
//
// Adapter, not core: the fs/path I/O lives here so the core ports stay pure (AD-1).
// Crash-proof and local-first: a missing, corrupt, or read-only file degrades to
// an in-memory set rather than breaking the tools.

import * as fs from "node:fs";
import * as path from "node:path";

/** Write `value` as pretty JSON to `filePath`, creating parent dirs. Swallows all
 * errors so a read-only / unwritable FS degrades to in-memory rather than throwing
 * — shared by every disk store (the set-stores below and the enrichment cache). */
export function writeJsonSync(filePath: string, value: unknown): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  } catch {
    // read-only FS or similar → caller stays in-memory only
  }
}

/** Read a file's text, or `undefined` if it can't be read (missing/unreadable).
 * The JSON parse is the caller's concern, since each store parses differently. */
export function readTextSync(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

/** The structural port the set-stores expose — `all` / `save` / `remove`, keyed by
 * an item's id. DiagramStore / DocStore / OverlayStore each match this exactly, so
 * a `repoJsonStore` result is assignable to any of them. */
export interface JsonSetStore<TSet, TItem> {
  all(): Promise<TSet>;
  save(item: TItem): Promise<void>;
  remove(id: string): Promise<boolean>;
}

/** The pure set operations a concrete store threads in — all already defined in
 * core (e.g. emptyDiagramSet / parseDiagramSet / upsertDiagram / removeDiagram). */
export interface JsonSetSpec<TSet, TItem> {
  /** Parse persisted text into a set, tolerating corruption (tagged result). */
  readonly parse: (text: string) => { ok: true; set: TSet } | { ok: false };
  /** A fresh empty set — the fallback for a missing or corrupt file. */
  readonly empty: () => TSet;
  /** Insert-or-replace an item by its id (immutable). */
  readonly upsert: (set: TSet, item: TItem) => TSet;
  /** Remove an item by id (immutable, no-op if absent). */
  readonly removeFrom: (set: TSet, id: string) => TSet;
  /** The set's items, for the membership ("did it exist?") check on remove. */
  readonly items: (set: TSet) => readonly { readonly id: string }[];
}

/**
 * Build a disk-backed set-store at `filePath` from a set's pure operations. The
 * set is loaded once on first access and held in memory; each change writes the
 * whole set back through. All disk failures are swallowed so the store always
 * works as at least an in-memory set.
 */
export function repoJsonStore<TSet, TItem>(
  filePath: string,
  spec: JsonSetSpec<TSet, TItem>,
): JsonSetStore<TSet, TItem> {
  let set: TSet | undefined;

  const load = (): TSet => {
    if (set !== undefined) return set;
    const text = readTextSync(filePath);
    if (text === undefined) {
      set = spec.empty(); // missing file
      return set;
    }
    const parsed = spec.parse(text);
    set = parsed.ok ? parsed.set : spec.empty(); // corrupt file → empty
    return set;
  };

  const persist = (next: TSet): void => {
    set = next;
    writeJsonSync(filePath, next);
  };

  return {
    all: () => Promise.resolve(load()),
    save: (item: TItem) => {
      persist(spec.upsert(load(), item));
      return Promise.resolve();
    },
    remove: (id: string) => {
      const before = load();
      const had = spec.items(before).some((x) => x.id === id);
      if (had) persist(spec.removeFrom(before, id));
      return Promise.resolve(had);
    },
  };
}
