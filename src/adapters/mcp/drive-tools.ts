import { z } from "zod";
import type { CodeGraph } from "../../core/graph/graph.js";
import {
  validatePresentationCommand,
  HIGHLIGHT_STYLES,
  PANEL_KINDS,
  AFFORDANCE_KINDS,
  PROJECTION_KINDS,
  type PresentationCommandSink,
} from "../../core/presentation/command.js";
import { traceToAddresses } from "../../core/presentation/log-trace.js";
import { ok, fail, ADDRESS, type GraphTool, type McpToolResult } from "./mcp-tool.js";

// The capability-gated DRIVE-the-board verbs (FR-39): the tools that steer the human's
// LIVE explorer — highlight, focus, projection, panels, lenses, reveal-in-editor, and
// timed replays. Present only when the host wires the command sink. Unlike the
// knowledge/overlay write tools these persist NOTHING — they emit an ephemeral command
// onto the presentation bus (FR-9, AD-14). Every emit is re-validated through the SHARED
// core codec, so the agent (UNTRUSTED) can't push a command the webview would reject.

// Presentation-command vocabularies — the core codec is the source of truth
// (validatePresentationCommand re-checks every emit); these only sharpen the input schema.
const HIGHLIGHT_STYLE = z.enum(HIGHLIGHT_STYLES as unknown as [string, ...string[]]);
const PANEL = z.enum(PANEL_KINDS as unknown as [string, ...string[]]);
const AFFORDANCE = z.enum(AFFORDANCE_KINDS as unknown as [string, ...string[]]);
const PROJECTION = z.enum(PROJECTION_KINDS as unknown as [string, ...string[]]);

export function driveTools(getGraph: () => CodeGraph, commands: PresentationCommandSink): GraphTool[] {
  // Build → re-validate through the shared core codec → emit onto the ephemeral bus.
  const drive = async (raw: unknown): Promise<McpToolResult> => {
    const command = validatePresentationCommand(raw);
    if (!command) return fail("codegraph: not a valid presentation command.");
    await commands.emit(command);
    return ok({ presented: command });
  };

  return [
    {
      name: "highlight_nodes",
      title: "Highlight nodes",
      description:
        "Point the human at a set of nodes on the LIVE board: a transient highlight that lifts them " +
        "above everything else (it overrides any persistent mark while engaged, and clears when you " +
        "highlight again or the human takes control). Use it while explaining — 'look at these' — not " +
        "to record anything (use mark_node for a durable badge). Style accent (default), trace, or warn. " +
        "Drives the view only; never touches source files. Requires the human to have the explorer open.",
      inputSchema: {
        addresses: z.array(ADDRESS).min(1).describe("The node addresses to highlight."),
        style: HIGHLIGHT_STYLE.optional().describe(`Highlight style: ${HIGHLIGHT_STYLES.join(", ")}.`),
      },
      handler: (args) =>
        drive({ kind: "highlight_nodes", addresses: args.addresses, style: args.style }),
    },
    {
      name: "highlight_path",
      title: "Highlight path",
      description:
        "Trace and highlight the dependency path between two nodes on the LIVE board — the board resolves " +
        "the route and lights it up (a 'trace' style). Use it to walk the human along a flow you're " +
        "explaining. Drives the view only; never touches source files.",
      inputSchema: {
        from: z.string().min(1).describe("Start node address."),
        to: z.string().min(1).describe("Target node address."),
      },
      handler: (args) => drive({ kind: "highlight_path", from: args.from, to: args.to }),
    },
    {
      name: "focus_camera",
      title: "Focus camera",
      description:
        "Move the LIVE board's camera to frame a set of nodes. By default it also selects the set's head " +
        "(opening its detail panel); pass select:false to only move the viewport without changing the " +
        "selection. Use it to bring the human's attention to a region. Drives the view only; never " +
        "touches source files.",
      inputSchema: {
        addresses: z.array(ADDRESS).min(1).describe("The node addresses to frame."),
        select: z
          .boolean()
          .optional()
          .describe("true (default) selects the set's head + frames it; false only moves the camera."),
      },
      handler: (args) =>
        drive({ kind: "focus_camera", addresses: args.addresses, select: args.select }),
    },
    {
      name: "set_projection",
      title: "Set projection",
      description:
        `Switch the LIVE board's projection (${PROJECTION_KINDS.join(", ")}) — full graph, the ` +
        "dependency view, the call view, or the structure (contains) view. Use it to reshape what the " +
        "human sees before walking them through it. Drives the view only; never touches source files.",
      inputSchema: {
        projection: PROJECTION.describe(`The projection to switch to: ${PROJECTION_KINDS.join(", ")}.`),
      },
      handler: (args) => drive({ kind: "set_projection", projection: args.projection }),
    },
    {
      name: "open_panel",
      title: "Open panel",
      description:
        `Open or close one of the board's panels (${PANEL_KINDS.join(", ")}) on the LIVE board — the ` +
        "diagrams drawer, the docs drawer, the ask panel, or the selected-node detail panel. Pass " +
        "open:false to close it. Use it to surface the knowledge you authored. Drives the view only; " +
        "never touches source files.",
      inputSchema: {
        panel: PANEL.describe(`Which panel: ${PANEL_KINDS.join(", ")}.`),
        open: z.boolean().optional().describe("true (default) opens, false closes."),
      },
      handler: (args) => drive({ kind: "open_panel", panel: args.panel, open: args.open }),
    },
    {
      name: "toggle_affordance",
      title: "Toggle affordance",
      description:
        `Toggle one of the board's view lenses (${AFFORDANCE_KINDS.join(", ")}) on the LIVE board — the ` +
        "orphans dim, the folder clustering, or the trace-path mode. Pass on:true/false for an explicit " +
        "state, or omit it to flip. Drives the view only; never touches source files.",
      inputSchema: {
        affordance: AFFORDANCE.describe(`Which lens: ${AFFORDANCE_KINDS.join(", ")}.`),
        on: z.boolean().optional().describe("Explicit desired state; omit to flip the current one."),
      },
      handler: (args) => drive({ kind: "toggle_affordance", affordance: args.affordance, on: args.on }),
    },
    {
      name: "reveal_in_editor",
      title: "Reveal in editor",
      description:
        "Open a node in the human's REAL editor, jumping to its file and line — the " +
        "'now look at the actual code' verb. Pair it with find_symbol / find_nodes: " +
        "locate the node, then reveal it so the human lands right on it. The host " +
        "resolves the address to its file:line and opens it read-only; no source or " +
        "path travels through the command. Requires the human to have the codegraph " +
        "editor extension running (it is a no-op on the web board).",
      inputSchema: {
        address: ADDRESS.describe("The node address to open in the editor."),
      },
      handler: (args) => drive({ kind: "reveal", address: String(args.address) }),
    },
    {
      name: "guided_tour",
      title: "Guided tour",
      description:
        "Walk the human through an ORDERED sequence of nodes on the LIVE board over time — a guided tour. " +
        "The board lights each stop in turn (a growing trace trail) and follows the camera, pausing " +
        "dwellMs at each, with a 'replaying…' banner the human can interrupt at any step. Use it to " +
        "narrate a flow step by step — e.g. request → handler → service → store. Pass the addresses in " +
        "the order you want them visited. Drives the view only; never touches source files. Requires the " +
        "human to have the explorer open.",
      inputSchema: {
        addresses: z.array(ADDRESS).min(1).describe("The tour stops, in the order to visit them."),
        dwellMs: z
          .number()
          .optional()
          .describe("Pause per stop in ms (clamped 200–10000; default 1200)."),
      },
      handler: (args) => drive({ kind: "replay", addresses: args.addresses, dwellMs: args.dwellMs }),
    },
    {
      name: "replay_trace",
      title: "Replay a stack trace",
      description:
        "Turn a runtime stack trace or error log into a guided tour on the LIVE board — paste the raw " +
        "trace text and the board walks the human through the nodes it touched, in the order the trace " +
        "lists them (innermost-first for Node/V8, outermost-first for Python). Frames that don't map to a " +
        "known node are skipped; if none map, nothing happens. Use it to walk a crash or a profiled path. " +
        "Drives the view only; never touches source files. Requires the human to have the explorer open.",
      inputSchema: {
        trace: z.string().min(1).describe("The raw stack trace / error log text."),
        dwellMs: z
          .number()
          .optional()
          .describe("Pause per stop in ms (clamped 200–10000; default 1200)."),
      },
      handler: (args) => {
        const addresses = traceToAddresses(args.trace, getGraph().allNodes());
        if (addresses.length === 0) {
          return fail("codegraph: no frames in that trace mapped to a known node.");
        }
        return drive({ kind: "replay", addresses, dwellMs: args.dwellMs });
      },
    },
  ];
}
