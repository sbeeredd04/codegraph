import * as path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

// Shared CLI runtime: the command contract every subcommand implements, plus the host
// helpers they lean on. Keeping this thin and separate lets each command live in its
// own single-responsibility file and be registered in a table — adding a command is a
// new file + one row, never an edit to a growing main() (open/closed).

const require = createRequire(__filename);

/** The parsed invocation handed to a command: its positional args (with the command
 *  name already stripped), the raw flag set, and the working directory. */
export interface CliInvocation {
  readonly positionals: readonly string[];
  readonly flags: ReadonlySet<string>;
  readonly cwd: string;
}

/** One CLI subcommand. `usage`/`summary` drive the generated `--help`; `run` does the
 *  work. Registered in `commands/index.ts` — see that file to add one. */
export interface CliCommand {
  readonly name: string;
  /** One-line `codegraph <name> …` usage shown in help. */
  readonly usage: string;
  /** One-line description shown in help. */
  readonly summary: string;
  readonly run: (inv: CliInvocation) => void | Promise<void>;
}

/** The tree-sitter grammar directory (`@vscode/tree-sitter-wasm`), resolved at runtime
 *  so the wasm assets ship with the dependency, not the bundle. */
export function wasmDir(): string {
  return path.dirname(require.resolve("@vscode/tree-sitter-wasm"));
}

/** The bundled Next export. `dist/cli.js` sits beside `media/` in the package, so the
 *  board is one level up from this bundle. */
export function exportDir(): string {
  return path.join(__dirname, "..", "media", "explorer");
}

/** The repo root a command operates on: its first positional, or the cwd. */
export function resolveRoot(inv: CliInvocation): string {
  return path.resolve(inv.positionals[0] ?? inv.cwd);
}

/** Open the board in the default browser (best-effort — a headless box just prints the
 *  URL and the server keeps running). */
export function openBrowser(url: string): void {
  if (process.env.CODEGRAPH_NO_OPEN) return; // headless / CI / smoke tests
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    /* best-effort — never fail the serve because a browser couldn't be launched */
  }
}
