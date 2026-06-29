import { useMemo } from "react";
import type { GraphNode, GraphEdge, NodeKind } from "@core/graph/types";
import type { Diagram } from "@core/diagrams/diagram";
import { DIAGRAM_SET_VERSION } from "@core/diagrams/diagram";
import type { Doc } from "@core/docs/doc";
import { DOC_SET_VERSION } from "@core/docs/doc";
import type { Overlay } from "@core/overlays/overlay";
import { nodeOverlays, overlayHighlights, OVERLAY_SET_VERSION } from "@core/overlays/overlay";
import { groundingCoverage } from "@core/overlays/grounding";
import { buildOnboardPlaybook } from "@core/onboard/playbook";
import { MARK_CANVAS_COLOR } from "@/lib/overlay-style";
import { KIND_COLORS } from "@/lib/graph-data";

/** The selected node, reduced to the address the overlay query helper needs. */
interface OverlayDetail {
  readonly node: { readonly address: string };
}

interface AgentOverlaysInput {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly diagrams?: readonly Diagram[];
  readonly docs?: readonly Doc[];
  readonly overlays?: readonly Overlay[];
  /** The currently-selected node, or null — drives the per-node overlay lookup. */
  readonly detail: OverlayDetail | null;
}

/**
 * Derive everything the board needs from the agent's authored knowledge (FR-37,
 * FR-42): the selected node's overlays for the detail panel, the per-node canvas
 * tints so the 2D surface can mark nodes, the grouped-address set, and the
 * on-install onboarding playbook. All resolved through the SAME pure-core helpers
 * the codegraph MCP tools use, so the human sees exactly what the agent sees.
 * Extracted from the Explorer shell to hold it under the file-size cap.
 */
export function useAgentOverlays({ nodes, edges, diagrams, docs, overlays, detail }: AgentOverlaysInput) {
  // The agent's overlays wrapped as a set so the core query helpers can pick out
  // the selected node's note/markers/groups and the canvas-level highlights.
  const overlaySet = useMemo(
    () => ({ version: OVERLAY_SET_VERSION, overlays: overlays ?? [] }),
    [overlays],
  );
  const selectedOverlays = useMemo(
    () => (detail ? nodeOverlays(overlaySet, detail.node.address) : undefined),
    [detail, overlaySet],
  );
  // The dominant mark per node + the grouped-address set, resolved once in core.
  // markedNodes maps each marked address to its canvas colour so the 2D surface
  // can tint the node itself — the agent pointing at the graph, not just the panel.
  const overlayHl = useMemo(() => overlayHighlights(overlaySet), [overlaySet]);
  const markedNodes = useMemo(() => {
    const m = new Map<string, string>();
    for (const [address, mark] of overlayHl.marks) m.set(address, MARK_CANVAS_COLOR[mark.mark]);
    return m;
  }, [overlayHl]);

  // The agent's on-install bootstrap checklist, mirrored for the human. Built from
  // the SAME inputs the codegraph_onboard MCP tool reads — the live snapshot's
  // graph shape + its agent-authored diagrams/docs/overlays — through the SAME
  // pure-core builder, so the Setup panel shows exactly what the agent sees.
  const playbook = useMemo(() => {
    const byKind = Object.fromEntries(
      (Object.keys(KIND_COLORS) as NodeKind[]).map((k) => [k, 0]),
    ) as Record<NodeKind, number>;
    for (const n of nodes) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
    return buildOnboardPlaybook({
      stats: { nodeCount: nodes.length, edgeCount: edges.length, byKind },
      diagrams: { version: DIAGRAM_SET_VERSION, diagrams: diagrams ? [...diagrams] : [] },
      docs: { version: DOC_SET_VERSION, docs: docs ? [...docs] : [] },
      overlays: overlaySet,
    });
  }, [nodes, edges, diagrams, docs, overlaySet]);

  // FR-62 grounding coverage: how many nodes carry an agent-authored note, the
  // payoff the bulk `ground_nodes` MCP tool drives toward. Same pure-core helper
  // the tool reports with, so the Setup panel's "N of M grounded" matches what the
  // agent sees. Anchored by node address (never source bytes) — cloud-safe (AD-14).
  const coverage = useMemo(
    () => groundingCoverage(overlaySet, new Set(nodes.map((n) => n.address))),
    [nodes, overlaySet],
  );

  return { selectedOverlays, markedNodes, grouped: overlayHl.grouped, playbook, coverage };
}
