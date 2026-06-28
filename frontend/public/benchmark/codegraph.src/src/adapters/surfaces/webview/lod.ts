import type { NodeKind } from "../../../core/graph/types.js";

// Semantic-zoom level-of-detail (FR-5): bound the nodes drawn per altitude so a
// large repo reads as architecture when zoomed out and reveals detail as you
// zoom in. `ratio` is Sigma's camera ratio (larger = further out).
//
//   far   (>= 1.5): modules only
//   mid   (>= 0.7): hide methods (show module/class/function/workflow)
//   near  (<  0.7): everything

export function nodeHiddenAtRatio(kind: NodeKind, ratio: number): boolean {
  if (ratio >= 1.5) return kind !== "module";
  if (ratio >= 0.7) return kind === "method";
  return false;
}
