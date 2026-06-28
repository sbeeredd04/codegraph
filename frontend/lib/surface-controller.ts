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
  /** Step through a sequence of addresses over time (FR-40 guided tour /
   * FR-41 log-trace replay). A typed no-op until Phase C wires it. */
  replay(addresses: readonly string[]): void;
}
