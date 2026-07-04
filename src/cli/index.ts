import { DEFAULT_COMMAND, findCommand, helpText } from "./commands/index.js";
import type { CliInvocation } from "./runtime.js";

// The `codegraph` CLI entry — a thin dispatcher. It parses argv into flags +
// positionals, resolves the command (a registered name, else the default `serve`), and
// runs it. Every command is host-local + read-only (AD-16 / FR-9); the subcommands and
// their shared runtime live in ./commands/* and ./runtime (one responsibility each, so
// adding a command never touches this file). See ./commands/index for the registry.

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith("-")));
  const positionals = argv.filter((a) => !a.startsWith("-"));

  if (flags.has("-h") || flags.has("--help")) {
    process.stderr.write(helpText());
    return;
  }

  // First positional is a command name if it's registered; otherwise it's an argument
  // for the default command (e.g. `codegraph /path` → serve /path).
  const named = findCommand(positionals[0]);
  const command = named ?? DEFAULT_COMMAND;
  const commandPositionals = named ? positionals.slice(1) : positionals;
  const inv: CliInvocation = { positionals: commandPositionals, flags, cwd: process.cwd() };
  await command.run(inv);
}

main().catch((err: unknown) => {
  process.stderr.write(`codegraph failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
