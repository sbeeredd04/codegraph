// FR-43: the imperative handle a graph render surface exposes so the host — and,
// through the FR-39 command bus to come, the user's connected agent — can DRIVE
// the surface, not merely react to a selection. The 2D Sigma canvas and the 3D
// canvas each implement this against their own substrate; the Explorer holds a
// single ref and the mounted surface populates it, so the call-site is identical
// across surfaces (AD-15). Generalises the old single `(address) => void` focusRef.

// The transient-highlight vocabulary is owned by the core presentation-command
// codec (FR-39) so the driving command and the renderer agree by construction;
// re-exported here for the controller's own callers. A highlight is live emphasis
// distinct from a persistent overlay MARK (FR-37): never serialised, it wins over
// the ambient mark tint while engaged and clears the moment the driver moves on.
import type { HighlightStyle } from "@core/presentation/command";
export { HIGHLIGHT_STYLES } from "@core/presentation/command";
export type { HighlightStyle };

export interface SurfaceController {
  /** The primary "look here": select the set's head + frame the whole set. A
   * single address reproduces the old focus (select + centre); a set frames them
   * together. */
  focus(addresses: readonly string[]): void;
  /** Fit the camera to a node set WITHOUT changing the selection or any lens —
   * the agent moving the viewport, not picking. */
  frame(addresses: readonly string[]): void;
  /** Apply a transient highlight to a node set, or clear it with an empty set.
   * Lives above the ambient overlay tint — it is the driver actively pointing. */
  highlight(addresses: readonly string[], style?: HighlightStyle): void;
  /** Walk a sequence of addresses over time as a guided tour (FR-40): light each
   * stop cumulatively and follow the camera, one per `dwellMs` beat. Honours
   * `prefers-reduced-motion` (collapses to the final state). Any other controller
   * call — or the human taking control — preempts an in-flight tour. The 3D
   * surface wires this in slice 2; until then its implementation is a no-op. */
  replay(addresses: readonly string[], opts?: { dwellMs?: number }): void;
  /** FR-47: ease the camera back to the default framing. 3D-only — the 2D Sigma
   * surface has no perspective camera, so it leaves this undefined. */
  resetCamera?(): void;
  /** FR-47: frame the whole graph's bounding sphere from any zoom. 3D-only. */
  fitCamera?(): void;
  /** FR-48: fly a cinematic tour through the selected node's neighbourhood.
   * 3D-only; a no-op/absent on 2D. Requires a current selection to have a path. */
  playTour?(): void;
}
