// FR-43: the imperative handle a graph render surface exposes so the host — and,
// through the FR-39 command bus to come, the user's connected agent — can DRIVE
// the surface, not merely react to a selection. The 2D Sigma canvas and the 3D
// canvas each implement this against their own substrate; the Explorer holds a
// single ref and the mounted surface populates it, so the call-site is identical
// across surfaces (AD-15). Generalises the old single `(address) => void` focusRef.

/** A transient visual emphasis a driver can pulse onto a node set — distinct from
 * a persistent overlay MARK (a saved agent annotation, FR-37). This is live: it
 * is never serialised, it wins over the ambient mark tint while engaged, and it
 * clears the moment the driver moves on. */
export type HighlightStyle = "accent" | "trace" | "warn";

export const HIGHLIGHT_STYLES: readonly HighlightStyle[] = ["accent", "trace", "warn"];

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
