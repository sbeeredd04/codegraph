// Disk-backed presentation-command bus (Epic 19 / FR-39 slice B): the host-local
// transport that carries the agent's live view directives from the standalone MCP
// server process to the extension's live ExplorerPanel. The MCP side EMITS by
// appending one JSON line per command; the panel side DRAINS new lines by byte
// offset and forwards each to its webview. A transient queue, never durable state
// — it is never read into a GraphSnapshot (AD-14) and never touches source (FR-9).
//
// Both sides are crash-tolerant: an emit that fails (read-only FS, races) is
// swallowed — a dropped directive is non-fatal, the human keeps the wheel; a
// drain over a missing/garbled file yields nothing and advances cleanly. The
// commands are agent-authored and UNTRUSTED, so every drained line is re-validated
// through the SAME core codec the webview uses before it is handed on.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  validatePresentationCommand,
  type PresentationCommand,
  type PresentationCommandSink,
} from "../../core/presentation/command.js";

/**
 * A command sink that APPENDS each directive as a JSON line at `filePath`. Used by
 * the standalone MCP server's driving tools. Append (not rewrite) preserves order
 * and lets the panel tail incrementally. All disk failures are swallowed so a
 * driving tool never throws on a transient write.
 */
export function diskCommandSink(filePath: string): PresentationCommandSink {
  return {
    async emit(command: PresentationCommand): Promise<void> {
      try {
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.appendFile(filePath, `${JSON.stringify(command)}\n`, "utf8");
      } catch {
        // transient IPC: a dropped directive is non-fatal — degrade silently.
      }
    },
  };
}

/** A batch of commands drained from the queue, plus the byte offset to resume from. */
export interface DrainedCommands {
  readonly commands: readonly PresentationCommand[];
  /** Where the next drain should start — advances only past WHOLE consumed lines. */
  readonly offset: number;
}

/**
 * Read every WHOLE command line at `filePath` after byte `offset`, validating each
 * through the core codec (malformed lines dropped) and returning the new commands
 * plus the offset to resume from. A partial trailing line (an emit mid-flight) is
 * intentionally left unconsumed so it is delivered intact on the next drain. The
 * panel seeds `offset` with the file's current size on open, so backlog never
 * replays — only directives issued while the board is live are forwarded.
 */
export function readCommandsFrom(filePath: string, offset: number): DrainedCommands {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    return { commands: [], offset }; // missing/unreadable — nothing to drain yet
  }
  // The file was truncated/rotated under us — restart from the top.
  const from = offset > buf.length ? 0 : offset;
  if (from >= buf.length) return { commands: [], offset: buf.length };

  const slice = buf.subarray(from).toString("utf8");
  const lastNewline = slice.lastIndexOf("\n");
  if (lastNewline < 0) return { commands: [], offset: from }; // only a partial line so far

  const whole = slice.slice(0, lastNewline + 1);
  const commands: PresentationCommand[] = [];
  for (const line of whole.split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // a torn/garbled line — skip it, keep draining
    }
    const command = validatePresentationCommand(parsed);
    if (command) commands.push(command);
  }
  return { commands, offset: from + Buffer.byteLength(whole, "utf8") };
}
