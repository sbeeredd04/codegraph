// Shared graph-view glue for the two Sigma surfaces: the in-editor webview
// (webview/main.ts) and the standalone snapshot viewer (web/viewer.ts). The two
// have genuinely different orchestration — live host messages with stable
// re-layout vs. a static local snapshot — but the DOM/Sigma details below are
// identical, so they live here once. This file is browser-only (it touches the
// DOM and Sigma) and is therefore outside the gate's `src/**` typecheck; it is
// covered by the manual webview typecheck (tsconfig.webview.json) and bundled
// into each surface by esbuild. The pure, unit-tested pieces (the card markup,
// the LOD thresholds) stay in src/.

import type Sigma from "sigma";
import type Graph from "graphology";
import { nodeHiddenAtRatio } from "../src/adapters/surfaces/webview/lod.js";
import { capabilityCardHtml } from "../src/adapters/surfaces/webview/card.js";
import { pathEdgeKey, type PathHighlight } from "../src/core/graph/path.js";
import type { NodeKind } from "../src/core/graph/types.js";
import type { NodeEnrichment } from "../src/core/semantic/enrichment.js";

// Orphan overlay (FR-12): when on, the reducers dim every non-orphan so the
// dead-code candidates stand alone. Recessive tones — still visible, just quiet.
// Shared so the panel and the viewer read the same.
export const ORPHAN_DIM_NODE = "#39414f";
export const ORPHAN_DIM_EDGE = "#262c38";

// Trace-path lens (PM-backlog #3): when a path is highlighted, off-path elements
// recede (reusing the orphan dim tones) and the route's edges light up in accent.
export const PATH_EDGE = "#a78bfa";

interface CardNodeAttrs {
  label: string;
  kind: string;
  color: string;
  file: string;
  line: number;
  enrichment?: NodeEnrichment;
  orphan?: boolean;
}

/**
 * Hover capability card (FR-11): read the node and its edges off the graph,
 * then defer the markup (and its escaping) to the pure, tested builder.
 */
export function showCard(graph: Graph, id: string, cardEl: HTMLElement): void {
  const a = graph.getNodeAttributes(id) as CardNodeAttrs;
  const byRel = new Map<string, string[]>();
  graph.forEachOutEdge(id, (_e: string, attrs: { relation?: string }, _s: string, target: string) => {
    const rel = attrs.relation ?? "edge";
    const list = byRel.get(rel) ?? [];
    list.push(target);
    byRel.set(rel, list);
  });
  const callers: string[] = [];
  graph.forEachInEdge(id, (_e: string, _attrs: unknown, source: string) => callers.push(source));

  cardEl.innerHTML = capabilityCardHtml({
    label: a.label,
    kind: a.kind,
    color: a.color,
    file: a.file,
    line: a.line,
    enrichment: a.enrichment,
    orphan: a.orphan,
    groups: Array.from(byRel.entries()),
    callers,
  });
  cardEl.classList.remove("hidden");
}

interface LensConfig {
  renderer: Sigma;
  graph: Graph;
  /** True for large graphs — enables semantic-zoom LOD culling (FR-5). */
  lod: boolean;
  /** Read fresh on every reducer run so toggling the overlay needs no relayout. */
  isOrphanMode: () => boolean;
  /** The currently-traced path, if any — read fresh per reducer run. When set,
   * its nodes/edges lead and everything else recedes (PM-backlog #3). */
  pathOn?: () => PathHighlight | undefined;
}

/**
 * Install the composed view lenses on a renderer (re-run cheaply on every
 * refresh()): semantic-zoom LOD for large graphs (FR-5), the orphan overlay
 * (FR-12), and the trace-path highlight (PM-backlog #3). Identical across both
 * surfaces; the path lens is a no-op when no `pathOn` is supplied.
 */
export function installLensReducers({ renderer, graph, lod, isOrphanMode, pathOn }: LensConfig): void {
  const camera = renderer.getCamera();
  // A path with at least one node is "active"; an empty highlight reads as off.
  const activePath = (): PathHighlight | undefined => {
    const hl = pathOn?.();
    return hl && hl.nodes.size > 0 ? hl : undefined;
  };
  renderer.setSetting("nodeReducer", (node: string, data: { kind: NodeKind }) => {
    const res: { kind: NodeKind; hidden?: boolean; color?: string; label?: string; forceLabel?: boolean } = {
      ...data,
    };
    if (lod && nodeHiddenAtRatio(data.kind, camera.ratio)) res.hidden = true;
    if (isOrphanMode()) {
      if (graph.getNodeAttribute(node, "orphan")) {
        res.hidden = false; // never lose an orphan you're hunting
        res.forceLabel = true;
      } else {
        res.color = ORPHAN_DIM_NODE;
        res.label = "";
      }
    }
    // Path lens takes precedence: a node on the traced route is always shown and
    // labeled; off-path nodes recede so the route is unmistakable.
    const path = activePath();
    if (path) {
      if (path.nodes.has(node)) {
        res.hidden = false;
        res.forceLabel = true;
        res.color = graph.getNodeAttribute(node, "color") as string; // undim if orphan-mode dimmed it
        res.label = graph.getNodeAttribute(node, "label") as string;
      } else {
        res.color = ORPHAN_DIM_NODE;
        res.label = "";
      }
    }
    return res;
  });
  renderer.setSetting("edgeReducer", (edge: string, data: object) => {
    const res: { hidden?: boolean; color?: string; size?: number; zIndex?: number } = { ...data };
    if (lod) {
      const sk = graph.getNodeAttribute(graph.source(edge), "kind") as NodeKind;
      const tk = graph.getNodeAttribute(graph.target(edge), "kind") as NodeKind;
      if (nodeHiddenAtRatio(sk, camera.ratio) || nodeHiddenAtRatio(tk, camera.ratio)) res.hidden = true;
    }
    if (isOrphanMode()) res.color = ORPHAN_DIM_EDGE; // recede the wiring so nodes lead
    const path = activePath();
    if (path) {
      res.color = path.edges.has(pathEdgeKey(graph.source(edge), graph.target(edge)))
        ? PATH_EDGE
        : ORPHAN_DIM_EDGE;
    }
    return res;
  });
  if (lod) camera.on("updated", () => renderer.refresh());
}

export interface OrphanToggle {
  /** Whether the overlay is currently on — read by the reducers. */
  readonly isActive: () => boolean;
  /** Reconcile the control with the current projection's orphan count. */
  readonly sync: (count: number) => void;
}

/**
 * Wire the topbar orphan-overlay control once. It owns the on/off state, flips
 * it on click (re-running the reducers via onChange — no relayout, so the camera
 * stays put), and stays honest about the count: it shows it, disables itself
 * when there is nothing to highlight, and drops out of the overlay if the
 * current projection has no orphans.
 */
export function createOrphanToggle(
  toggleEl: HTMLButtonElement,
  countEl: HTMLElement,
  onChange: () => void,
): OrphanToggle {
  let active = false;
  const reflect = (): void => {
    toggleEl.classList.toggle("active", active);
    toggleEl.setAttribute("aria-pressed", String(active));
  };
  toggleEl.addEventListener("click", () => {
    if (toggleEl.disabled) return;
    active = !active;
    reflect();
    onChange();
  });
  return {
    isActive: () => active,
    sync: (count: number) => {
      countEl.textContent = String(count);
      toggleEl.disabled = count === 0;
      if (count === 0 && active) active = false;
      reflect();
    },
  };
}

// Entrance tuning: a short ease-out in the 150-260ms band reads as "settling".
// The start scale is deliberately high (0.7, not near-zero) — a node growing
// from a dot feels like a jarring pop, whereas a gentle grow-and-settle is calm.
// This motion is secondary reinforcement; the change feed and delta badge carry
// the actual "what changed" information.
const ENTER_DURATION_MS = 260;
const ENTER_START_SCALE = 0.7;

/**
 * Motion polish: gently grow newly-added nodes to full size with an ease-out, so
 * a live update reads as "this appeared" rather than a silent jump. Honors
 * prefers-reduced-motion (no animation), and returns a canceller the caller MUST
 * invoke before the next repaint — a queued frame must never refresh() a renderer
 * that has since been killed.
 */
export function animateNodeEntrance(
  renderer: Sigma,
  graph: Graph,
  newIds: readonly string[],
): () => void {
  const noop = (): void => {};
  if (newIds.length === 0) return noop;
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return noop;
  }
  const targets = new Map<string, number>();
  for (const id of newIds) {
    if (graph.hasNode(id)) targets.set(id, graph.getNodeAttribute(id, "size") as number);
  }
  if (targets.size === 0) return noop;

  let cancelled = false;
  let raf = 0;
  const start = performance.now();
  const step = (now: number): void => {
    if (cancelled) return;
    const t = Math.min(1, (now - start) / ENTER_DURATION_MS);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
    const scale = ENTER_START_SCALE + (1 - ENTER_START_SCALE) * eased;
    for (const [id, size] of targets) {
      if (graph.hasNode(id)) graph.setNodeAttribute(id, "size", size * scale);
    }
    renderer.refresh();
    if (t < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}
