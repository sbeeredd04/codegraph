import type { CliCommand } from "../runtime.js";
import { serveCommand } from "./serve.js";
import { graphCommand } from "./graph.js";
import { queryCommand } from "./query.js";
import { skillCommand } from "./skill.js";

// The command registry. Adding a subcommand is a new file + one row here — nothing
// else in the CLI changes (open/closed). `serve` is the default (bare `codegraph` and
// `codegraph [dir]` land there).

export const DEFAULT_COMMAND: CliCommand = serveCommand;

export const COMMANDS: readonly CliCommand[] = [
  serveCommand,
  graphCommand,
  queryCommand,
  skillCommand,
];

const BY_NAME: ReadonlyMap<string, CliCommand> = new Map(COMMANDS.map((c) => [c.name, c]));

/** The registered command for a token, or undefined when it's not a command name (the
 *  token is then a positional for the default command, e.g. a directory). */
export function findCommand(name: string | undefined): CliCommand | undefined {
  return name === undefined ? undefined : BY_NAME.get(name);
}

/** `--help` text, generated from the registry so it can never drift from the commands.
 *  Long usage strings still get a ≥2-space gap before the summary. */
export function helpText(): string {
  const rows = COMMANDS.map((c) => {
    const gap = " ".repeat(Math.max(2, 40 - c.usage.length));
    return `  ${c.usage}${gap}${c.summary}`;
  });
  return (
    "Usage: codegraph [command] [dir]\n" +
    `${rows.join("\n")}\n` +
    "  CODEGRAPH_PORT overrides the serve port (default 4319).\n"
  );
}
