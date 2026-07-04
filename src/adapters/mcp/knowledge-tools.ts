import { z } from "zod";
import type { CodeGraph } from "../../core/graph/graph.js";
import type { NodeEnrichment } from "../../core/semantic/enrichment.js";
import type { NodeAnnotations } from "../../core/semantic/annotations.js";
import {
  validateDiagram,
  KNOWN_DIAGRAM_CATEGORIES,
  type DiagramStore,
} from "../../core/diagrams/diagram.js";
import { validateDoc, KNOWN_DOC_CATEGORIES, type DocStore } from "../../core/docs/doc.js";
import type { OverlayStore } from "../../core/overlays/overlay.js";
import { buildOnboardPlaybook } from "../../core/onboard/playbook.js";
import { graphStats } from "../../core/graph/query.js";
import { ok, fail, ADDRESS, type GraphTool, type RecentChangesProvider } from "./mcp-tool.js";

// The capability-gated KNOWLEDGE / write tools: the live change feed and the tools that
// author durable knowledge onto the graph (annotations, diagrams, docs) plus the
// on-install onboarding playbook. Each appears only when its backing store is wired
// (see the assembler in tools.ts). All write GRAPH METADATA only — never source files
// (FR-9). Overlay write tools live in overlay-tools.ts; this mirrors that pattern.

/** The live git change feed (recent_changes). */
export function recentChangesTool(recentChanges: RecentChangesProvider): GraphTool {
  return {
    name: "recent_changes",
    title: "Recent changes",
    description:
      "What changed in the working tree versus a git ref (default HEAD): the ranked " +
      "change feed — added, changed, removed and moved nodes ordered by blast radius. " +
      "Use this to see what you (or another agent) just changed and what it impacts.",
    inputSchema: {
      ref: z.string().min(1).optional().describe("Git ref to diff against (default HEAD)."),
    },
    handler: async (args) => {
      try {
        const ref = args.ref ? String(args.ref) : "HEAD";
        return ok(await recentChanges(ref));
      } catch (e) {
        return fail(e instanceof Error ? e.message : "codegraph: could not compute recent changes.");
      }
    },
  };
}

/** Record the agent's understanding of a node onto the graph (annotate_node). */
export function annotateTool(annotations: NodeAnnotations): GraphTool {
  return {
    name: "annotate_node",
    title: "Annotate node",
    description:
      "Record your understanding of a node onto the graph: a one-line summary of what it does, " +
      "why it exists (intent), and its architectural role. The human board and describe_node then " +
      "surface it. It's cached by the node's content hash, so it survives a move/rename but is " +
      "dropped once the node's signature or call set changes — annotate again when that happens. " +
      "This writes graph metadata only; it never touches source files.",
    inputSchema: {
      address: ADDRESS,
      summary: z.string().min(1).describe("One sentence: what this node does."),
      intent: z.string().optional().describe("Why it exists — the purpose it serves in the system."),
      role: z.string().optional().describe("Its architectural role, e.g. port, adapter, orchestrator."),
    },
    handler: async (args) => {
      const address = String(args.address);
      const enrichment: NodeEnrichment = {
        summary: String(args.summary ?? ""),
        intent: args.intent ? String(args.intent) : "",
        role: args.role ? String(args.role) : "",
      };
      const stored = await annotations.set(address, enrichment);
      return stored
        ? ok({ annotated: address, enrichment })
        : fail(`codegraph: no node at address "${address}".`);
    },
  };
}

/** Author + manage Mermaid diagrams on the knowledge layer (save/list/delete_diagram). */
export function diagramWriteTools(diagrams: DiagramStore): GraphTool[] {
  return [
    {
      name: "save_diagram",
      title: "Save diagram",
      description:
        "Save a Mermaid diagram you synthesized from the graph onto the repo's knowledge layer. " +
        "Explore first (find_nodes, neighborhood, dependencies, blast_radius, graph_stats), then " +
        "capture a higher-level view the structure graph can't show on its own: a user workflow end " +
        "to end, the system architecture, a request's sequence, a data flow. Prefer SEVERAL focused " +
        "diagrams over one giant one, each categorized — you choose the categories (suggested: " +
        `${KNOWN_DIAGRAM_CATEGORIES.join(", ")}). Re-saving the same title+category updates that ` +
        "diagram in place. The human board and the standalone viewer render these. Writes graph " +
        "metadata only; it never touches source files.",
      inputSchema: {
        title: z.string().min(1).describe("Short, specific title, e.g. 'Login request sequence'."),
        category: z
          .string()
          .min(1)
          .describe(`Category — you decide (suggested: ${KNOWN_DIAGRAM_CATEGORIES.join(", ")}).`),
        mermaid: z
          .string()
          .min(1)
          .describe("Mermaid source (fenced or raw), e.g. a flowchart, sequenceDiagram, or classDiagram."),
        description: z.string().optional().describe("One or two lines on what this diagram shows."),
        related: z
          .array(z.string())
          .optional()
          .describe("Graph node addresses this diagram is about, to link it back to the graph."),
      },
      handler: async (args) => {
        const result = validateDiagram({
          title: args.title,
          category: args.category,
          mermaid: args.mermaid,
          description: args.description,
          related: args.related,
          updatedAt: new Date().toISOString(),
        });
        if (!result.ok) return fail(`codegraph: ${result.error}`);
        await diagrams.save(result.diagram);
        return ok({
          saved: result.diagram.id,
          title: result.diagram.title,
          category: result.diagram.category,
        });
      },
    },
    {
      name: "list_diagrams",
      title: "List diagrams",
      description:
        "List the Mermaid diagrams already saved for this repo (id, title, category, description, and " +
        "source). Review these before adding more so you refine and fill gaps rather than duplicate.",
      inputSchema: {},
      handler: async () => ok(await diagrams.all()),
    },
    {
      name: "delete_diagram",
      title: "Delete diagram",
      description: "Delete a saved diagram by its id (as returned by save_diagram or list_diagrams).",
      inputSchema: {
        id: z.string().min(1).describe("The diagram id, e.g. 'workflow/login-flow'."),
      },
      handler: async (args) => {
        const id = String(args.id);
        const removed = await diagrams.remove(id);
        return removed ? ok({ deleted: id }) : fail(`codegraph: no diagram with id "${id}".`);
      },
    },
  ];
}

/** Author + manage long-form Markdown docs on the knowledge layer (save/list/delete_doc). */
export function docWriteTools(docs: DocStore): GraphTool[] {
  return [
    {
      name: "save_doc",
      title: "Save doc",
      description:
        "Save a long-form Markdown doc you wrote ABOUT this repo onto its knowledge layer — the prose " +
        "layer above the structure graph and the Mermaid diagrams: an onboarding guide, a module " +
        "deep-dive, an architecture overview, 'how this subsystem fits together'. Explore first " +
        "(find_nodes, neighborhood, dependencies, blast_radius, graph_stats), then write the doc and " +
        "link it back to the graph with `related` node addresses. Prefer SEVERAL focused docs over one " +
        "giant one, each categorized — you choose the categories (suggested: " +
        `${KNOWN_DOC_CATEGORIES.join(", ")}). Re-saving the same title+category updates that doc in ` +
        "place. The human board and the web explorer render these (Markdown is sanitized at the render " +
        "edge). Writes graph metadata only; it never touches source files.",
      inputSchema: {
        title: z.string().min(1).describe("Short, specific title, e.g. 'Onboarding: the graph pipeline'."),
        category: z
          .string()
          .min(1)
          .describe(`Category — you decide (suggested: ${KNOWN_DOC_CATEGORIES.join(", ")}).`),
        markdown: z
          .string()
          .min(1)
          .describe("Markdown body. Use codegraph://node/<address> links to deep-link into the graph."),
        related: z
          .array(z.string())
          .optional()
          .describe("Graph node addresses this doc is about, to link it back to the graph."),
      },
      handler: async (args) => {
        const result = validateDoc({
          title: args.title,
          category: args.category,
          markdown: args.markdown,
          related: args.related,
          updatedAt: new Date().toISOString(),
        });
        if (!result.ok) return fail(`codegraph: ${result.error}`);
        await docs.save(result.doc);
        return ok({
          saved: result.doc.id,
          title: result.doc.title,
          category: result.doc.category,
        });
      },
    },
    {
      name: "list_docs",
      title: "List docs",
      description:
        "List the Markdown docs already saved for this repo (id, title, category, and related nodes). " +
        "Review these before adding more so you refine and fill gaps rather than duplicate.",
      inputSchema: {},
      handler: async () => ok(await docs.all()),
    },
    {
      name: "delete_doc",
      title: "Delete doc",
      description: "Delete a saved doc by its id (as returned by save_doc or list_docs).",
      inputSchema: {
        id: z.string().min(1).describe("The doc id, e.g. 'onboarding/the-graph-pipeline'."),
      },
      handler: async (args) => {
        const id = String(args.id);
        const removed = await docs.remove(id);
        return removed ? ok({ deleted: id }) : fail(`codegraph: no doc with id "${id}".`);
      },
    },
  ];
}

/** The on-install bootstrap playbook (codegraph_onboard) — needs all three knowledge stores. */
export function onboardTool(
  getGraph: () => CodeGraph,
  stores: { diagrams: DiagramStore; docs: DocStore; overlays: OverlayStore },
): GraphTool {
  return {
    name: "codegraph_onboard",
    title: "Onboard this repo",
    description:
      "Run this FIRST when you attach to a repo. Returns an ordered, idempotent bootstrap checklist: " +
      "index the graph (already done on start), author a starter knowledge layer (a few diagrams via " +
      "save_diagram, an overview via save_doc, hotspot marks via mark_node), then hand off to the human. " +
      "Each step is marked done/todo from what's already saved, so re-running skips finished work and " +
      "shows only the gaps. Read-only; it recommends writes, it doesn't make them.",
    inputSchema: {},
    handler: async () => {
      const [diagramSet, docSet, overlaySet] = await Promise.all([
        stores.diagrams.all(),
        stores.docs.all(),
        stores.overlays.all(),
      ]);
      return ok(
        buildOnboardPlaybook({
          stats: graphStats(getGraph()),
          diagrams: diagramSet,
          docs: docSet,
          overlays: overlaySet,
        }),
      );
    },
  };
}
