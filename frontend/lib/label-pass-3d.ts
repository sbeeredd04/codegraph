// The 3D surface's HTML-overlay label pass (FR-65 + FR-72b-2), lifted out of
// graph-canvas-3d.tsx to hold the component under the file-size cap (the precedent
// set by lib/build-scene-3d, lib/surface-movie-3d, lib/surface-dev-hooks-3d). Each
// frame this projects the to-label nodes to screen, de-collides them in screen space
// (pure pass in lib/label-layout-3d), and drops a crisp HTML <div> per survivor over
// the WebGL canvas. Label TEXT is structural symbol/path strings set via textContent
// — never innerHTML — so agent-authored content can't render as markup.
//
// Built as a factory over LIVE getters (focus, hover, marks, trace, layer depths,
// density) so the component re-reads current state every frame without re-running its
// heavy build; the deps mirror the refs the draw loop already keeps current.

import type * as ThreeNS from "three";
import type { FocusHighlight } from "@core/graph/focus";
import {
  layoutLabels3D,
  labelDensityProfile,
  DEFAULT_LABEL_LAYOUT,
  type LabelCandidate,
  type LabelDensity,
} from "./label-layout-3d";

const SELECTED_HEX = "#c4b5fd"; // the centre's label, matching the selected-node tint
const LABEL_HEX = "#c9d3e3"; // every other label

/** What the label pass needs, as live getters + the static scene arrays. */
export interface LabelPass3DDeps {
  /** The HTML overlay layer the labels are dropped into (cleared each frame). */
  readonly labelLayer: HTMLElement;
  /** address → layout index, for resolving a node to its position + meta. */
  readonly indexOf: ReadonlyMap<string, number>;
  /** Per-index node meta — only the label text is read here. */
  readonly meta: readonly { readonly label: string }[];
  /** Per-index world positions (three Vector3). */
  readonly positions: readonly ThreeNS.Vector3[];
  /** Project a world position to screen px (+ z>1 == behind the camera). */
  readonly projectToScreen: (p: ThreeNS.Vector3) => { x: number; y: number; z: number };
  /** The current focus lens (FR-25), or null. */
  readonly focus: () => FocusHighlight | null;
  /** The FR-65 "Label density" setting (biases cap + de-collision packing). */
  readonly labelDensity: () => LabelDensity | undefined;
  /** The hovered node, or null. */
  readonly hoverId: () => string | null;
  /** The driver's transient highlight set (FR-43), or null. */
  readonly highlight: () => { set: ReadonlySet<string> } | null;
  /** The agent's persistent marks (FR-37), or undefined. */
  readonly marked: () => ReadonlyMap<string, string> | undefined;
  /** The manual trace's node set (FR-61), or null. */
  readonly trace: () => ReadonlySet<string> | null;
  /** The layered-analysis depth map (FR-72), or undefined when the lens is off. */
  readonly layerDepths: () => ReadonlyMap<string, number> | undefined;
}

/**
 * Build the frame-time label renderer. The returned function clears the overlay and
 * repaints the surviving labels from the current live state. Priority is LOWER = more
 * important (placed first, never displaced): selected/center < hover < driver-
 * highlight < mark < trace < focus-neighbour / lit shell.
 */
export function buildLabelPass3D(deps: LabelPass3DDeps): () => void {
  const { labelLayer, indexOf, meta, positions, projectToScreen } = deps;

  return function renderLabels(): void {
    const focus = deps.focus();
    // The user's "Label density" setting biases how many labels survive — a larger
    // focus cap + tighter packing when "dense", the reverse when "sparse".
    const density = labelDensityProfile(deps.labelDensity());
    const layoutOpts = { ...DEFAULT_LABEL_LAYOUT, padding: density.padding, maxNudge: density.maxNudge };

    const prio = new Map<string, number>();
    const bid = (id: string, p: number): void => {
      const cur = prio.get(id);
      if (cur == null || p < cur) prio.set(id, p);
    };
    if (focus) {
      bid(focus.center, 0);
      if (focus.nodes.size <= density.focusCap) for (const id of focus.nodes) bid(id, 5);
    }
    // FR-72b-2: while the layer lens is active, label each lit shell node so the
    // concentric analysis reads like the 2D surface (the focus lens above only reaches
    // the 1st-degree shell). Capped by the density profile so deep, crowded clouds
    // don't drown in text — the de-collision pass then thins what remains.
    const layers = deps.layerDepths();
    if (layers && layers.size > 0 && layers.size <= density.focusCap) {
      for (const id of layers.keys()) bid(id, 5);
    }
    const hoverId = deps.hoverId();
    if (hoverId) bid(hoverId, 1);
    const highlight = deps.highlight();
    if (highlight) for (const id of highlight.set) bid(id, 2);
    const marked = deps.marked();
    if (marked) for (const id of marked.keys()) if (!focus || focus.nodes.has(id)) bid(id, 3);
    const trace = deps.trace();
    if (trace) for (const id of trace) bid(id, 4); // FR-61

    labelLayer.replaceChildren();
    if (prio.size === 0) return;

    // Project the candidates (drop ones behind the camera), then de-collide in screen
    // space so the high-priority label wins a crowded cluster.
    const candidates: LabelCandidate[] = [];
    for (const [id, priority] of prio) {
      const i = indexOf.get(id);
      if (i == null) continue;
      const sp = projectToScreen(positions[i]);
      if (sp.z > 1) continue; // behind the camera
      candidates.push({ id, x: sp.x, y: sp.y, priority, text: meta[i].label });
    }
    for (const lbl of layoutLabels3D(candidates, layoutOpts)) {
      const el = document.createElement("div");
      el.textContent = lbl.text;
      el.className = "absolute -translate-y-1/2 whitespace-nowrap font-mono text-[11px] leading-none";
      el.style.left = `${lbl.x + 10}px`;
      el.style.top = `${lbl.y}px`;
      el.style.color = lbl.id === focus?.center ? SELECTED_HEX : LABEL_HEX;
      el.style.textShadow = "0 1px 3px rgba(0,0,0,0.85)";
      labelLayer.appendChild(el);
    }
  };
}
