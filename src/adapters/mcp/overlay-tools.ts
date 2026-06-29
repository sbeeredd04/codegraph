import { z } from "zod";
import type { CodeGraph } from "../../core/graph/graph.js";
import {
  validateNote,
  validateMark,
  validateGroup,
  nodeOverlays,
  MARK_KINDS,
  MARK_SEVERITIES,
  type OverlayStore,
} from "../../core/overlays/overlay.js";
import { groundNodes, groundingCoverage } from "../../core/overlays/grounding.js";
import { ok, fail, ADDRESS, type GraphTool } from "./mcp-tool.js";

// The agent's overlay WRITE tools (Epic 19 / FR-37, FR-62): pin notes, ground nodes
// in bulk, annotate edges, mark and group nodes — the durable knowledge the agent
// authors ON the graph. Split out of tools.ts to keep that registry under the size
// cap; the read/drive tools stay there. Every tool here writes graph metadata only
// (anchored by node/edge identity, never source bytes) and never touches source
// files (FR-9). Appears only when the host injects an OverlayStore.

const EDGE_TYPE = z.enum(["calls", "depends-on", "contains", "hands-off-to"]);
// Mirror the core MARK_KINDS / MARK_SEVERITIES enums (validateMark is the source of
// truth; these only sharpen the MCP input schema). Cast because z.enum wants a
// non-empty tuple and the core arrays are readonly.
const MARK_KIND = z.enum(MARK_KINDS as unknown as [string, ...string[]]);
const MARK_SEVERITY = z.enum(MARK_SEVERITIES as unknown as [string, ...string[]]);

/** Build the overlay write tools bound to the live graph accessor + the store. */
export function overlayWriteTools(getGraph: () => CodeGraph, overlays: OverlayStore): GraphTool[] {
  return [
    {
      name: "pin_note",
      title: "Pin note",
      description:
        "Pin a free-form Markdown note onto a node — what it does, what happened here, a gotcha, " +
        "a decision. This is your durable memory on the graph: the human board surfaces it on the " +
        "node, and it rides the exported snapshot. Anchored by the node's identity, so one note per " +
        "node — re-pinning replaces it (put several thoughts in one body). Writes graph metadata " +
        "only; it never touches source files.",
      inputSchema: {
        address: ADDRESS,
        body: z.string().min(1).describe("Markdown note about this node."),
      },
      handler: async (args) => {
        const result = validateNote({
          anchor: { on: "node", address: String(args.address ?? "") },
          body: args.body,
          updatedAt: new Date().toISOString(),
        });
        if (!result.ok) return fail(`codegraph: ${result.error}`);
        await overlays.save(result.overlay);
        return ok({ saved: result.overlay.id, kind: "note", on: "node", address: args.address });
      },
    },
    {
      name: "ground_nodes",
      title: "Ground nodes",
      description:
        "Ground MANY nodes in one call: attach a human-legible note (what it does, why it exists) to " +
        "a whole batch of nodes, so the graph carries explanations before anyone asks. This is the " +
        "BULK form of pin_note — pass an array of { address, body }. Each body is Markdown, anchored " +
        "by node identity, so re-grounding a node replaces its note. Addresses not in the current " +
        "graph are reported back (not stored), and the reply tells you how many landed plus the " +
        "overall grounding coverage — chunk large repos and re-call to fill the gaps. Writes graph " +
        "metadata only; it never touches source files.",
      inputSchema: {
        groundings: z
          .array(
            z.object({
              address: ADDRESS,
              body: z.string().min(1).describe("Markdown: what this node does / why it exists."),
            }),
          )
          .min(1)
          .max(1000)
          .describe("The batch of node groundings to apply (up to 1000 per call)."),
      },
      handler: async (args) => {
        const known = new Set(getGraph().allNodes().map((n) => n.address));
        const current = await overlays.all();
        const now = new Date().toISOString();
        const inputs = (args.groundings as { address?: unknown; body?: unknown }[]).map((g) => ({
          address: String(g?.address ?? ""),
          body: String(g?.body ?? ""),
          updatedAt: now,
        }));
        const result = groundNodes(current, inputs, known);
        // Persist each note that landed through the same store pin_note writes to;
        // the merged set is the source of truth for the upserted Note objects.
        for (const address of result.applied) {
          const note = nodeOverlays(result.set, address).note;
          if (note) await overlays.save(note);
        }
        return ok({
          applied: result.applied,
          skipped: result.skipped,
          coverage: groundingCoverage(result.set, known),
        });
      },
    },
    {
      name: "annotate_edge",
      title: "Annotate edge",
      description:
        "Pin a free-form Markdown note onto an EDGE — explain a relationship: why this call is the hot " +
        "path, what this dependency is for, how data hands off across this boundary. Identified by the " +
        "directed edge (from, to, type), so one note per edge — re-annotating replaces it. Writes graph " +
        "metadata only; it never touches source files.",
      inputSchema: {
        from: z.string().min(1).describe("Source node address of the edge."),
        to: z.string().min(1).describe("Target node address of the edge."),
        type: EDGE_TYPE.describe("The edge relation: calls, depends-on, contains, or hands-off-to."),
        body: z.string().min(1).describe("Markdown note about this relationship."),
      },
      handler: async (args) => {
        const result = validateNote({
          anchor: {
            on: "edge",
            from: String(args.from ?? ""),
            to: String(args.to ?? ""),
            type: args.type,
          },
          body: args.body,
          updatedAt: new Date().toISOString(),
        });
        if (!result.ok) return fail(`codegraph: ${result.error}`);
        await overlays.save(result.overlay);
        return ok({ saved: result.overlay.id, kind: "note", on: "edge" });
      },
    },
    {
      name: "mark_node",
      title: "Mark node",
      description:
        "Set a typed marker on a node so it stands out on the board: a bug, a breakpoint, an issue, a " +
        `todo, or a hotspot (${MARK_KINDS.join(", ")}). Optionally add a severity ` +
        `(${MARK_SEVERITIES.join(", ")}) and a one-line label. One marker of each kind per node — ` +
        "re-marking updates it. Use this to flag where to look. Writes graph metadata only; it never " +
        "touches source files.",
      inputSchema: {
        address: ADDRESS,
        mark: MARK_KIND.describe(`The marker kind: ${MARK_KINDS.join(", ")}.`),
        severity: MARK_SEVERITY.optional().describe(`Optional severity: ${MARK_SEVERITIES.join(", ")}.`),
        label: z.string().optional().describe("Optional one-line label for the marker."),
      },
      handler: async (args) => {
        const result = validateMark({
          address: args.address,
          mark: args.mark,
          severity: args.severity,
          label: args.label,
          updatedAt: new Date().toISOString(),
        });
        if (!result.ok) return fail(`codegraph: ${result.error}`);
        await overlays.save(result.overlay);
        return ok({ saved: result.overlay.id, kind: "mark", mark: args.mark });
      },
    },
    {
      name: "group_nodes",
      title: "Group nodes",
      description:
        "Gather a set of node addresses into a labelled group — a feature, a subsystem, a request path " +
        "you identified across the graph. The board can highlight the group together. Identified by its " +
        "label, so re-saving the same label updates its members. Writes graph metadata only; it never " +
        "touches source files.",
      inputSchema: {
        label: z.string().min(1).describe("The group's display label, e.g. 'Auth flow'."),
        members: z.array(z.string()).min(1).describe("The node addresses in this group."),
      },
      handler: async (args) => {
        const result = validateGroup({
          label: args.label,
          members: args.members,
          updatedAt: new Date().toISOString(),
        });
        if (!result.ok) return fail(`codegraph: ${result.error}`);
        await overlays.save(result.overlay);
        return ok({ saved: result.overlay.id, kind: "group", label: result.overlay.label });
      },
    },
    {
      name: "list_overlays",
      title: "List overlays",
      description:
        "List the overlays already pinned to this repo's graph — notes, markers, and groups (each with " +
        "its id and anchor). Review these before adding more so you refine and fill gaps rather than " +
        "duplicate.",
      inputSchema: {},
      handler: async () => ok(await overlays.all()),
    },
    {
      name: "remove_overlay",
      title: "Remove overlay",
      description:
        "Remove an overlay by its id (as returned by pin_note, mark_node, group_nodes, annotate_edge, " +
        "or list_overlays).",
      inputSchema: {
        id: z.string().min(1).describe("The overlay id, e.g. 'note/65268690' or 'mark/bug/abc123'."),
      },
      handler: async (args) => {
        const id = String(args.id);
        const removed = await overlays.remove(id);
        return removed ? ok({ deleted: id }) : fail(`codegraph: no overlay with id "${id}".`);
      },
    },
  ];
}
