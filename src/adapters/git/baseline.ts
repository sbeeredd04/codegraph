import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CodeGraph } from "../../core/graph/graph.js";
import { bootstrapRepo, type BootstrapOptions } from "../lang/bootstrap.js";

// Git baseline (Story 2.5): build the graph as it was at a ref (HEAD, a branch)
// so the panel can diff "what changed since then" without an in-session edit.
// Read-only w.r.t. the working tree (FR-9): a detached worktree at the ref is
// materialized in a temp dir, scanned, and removed — the working tree is never
// stashed or touched. I/O lives here (adapter), never the core (AD-1).

const run = promisify(execFile);

export type GitRunner = (args: readonly string[], cwd: string) => Promise<string>;

const realGit: GitRunner = async (args, cwd) => {
  // execFile (no shell) — the ref is a literal argument, never interpolated.
  const { stdout } = await run("git", [...args], { cwd, maxBuffer: 32 * 1024 * 1024 });
  return stdout.trim();
};

// Reject refs that could be read as git options (argument injection).
function assertSafeRef(ref: string): void {
  if (!ref || ref.startsWith("-")) throw new Error(`codegraph: invalid git ref "${ref}".`);
}

// Give the baseline worktree the same dependencies as the working tree so
// ts-morph/Pyright resolve the SAME edges. Without it, every file that imports a
// dependency reads as "changed" purely because the worktree has no node_modules —
// drowning the real diff in noise. A symlink (not a copy) keeps it cheap, and
// node_modules is gitignored so it never enters the graph.
function linkNodeModules(repoRoot: string, worktree: string): void {
  const src = path.join(repoRoot, "node_modules");
  if (!fs.existsSync(src)) return;
  try {
    fs.symlinkSync(src, path.join(worktree, "node_modules"), "dir");
  } catch {
    // best-effort: without it the diff is noisier but still correct at node level.
  }
}

/** Build a CodeGraph from the repo as it stood at `ref`. Throws on an unknown ref. */
export async function baselineGraph(
  repoRoot: string,
  ref: string,
  wasmDir: string,
  options: BootstrapOptions = {},
  runGit: GitRunner = realGit,
): Promise<CodeGraph> {
  assertSafeRef(ref);
  // Resolve to a concrete commit SHA first: this validates the ref and means the
  // worktree is created from a known commit, not raw ref text.
  let sha = "";
  try {
    sha = await runGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], repoRoot);
  } catch {
    sha = "";
  }
  if (!sha) throw new Error(`codegraph: "${ref}" is not a commit in this repository.`);

  // mkdtemp gives a unique base; git worktree add needs a non-existent target.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "codegraph-baseline-"));
  const worktree = path.join(base, "tree");
  try {
    await runGit(["worktree", "add", "--detach", worktree, sha], repoRoot);
    linkNodeModules(repoRoot, worktree);
    const { graph } = await bootstrapRepo(worktree, wasmDir, options);
    return graph;
  } finally {
    // Drop the symlink before removal so cleanup never touches the real tree.
    try {
      fs.unlinkSync(path.join(worktree, "node_modules"));
    } catch {
      /* not linked */
    }
    try {
      await runGit(["worktree", "remove", "--force", worktree], repoRoot);
    } catch {
      // best-effort: prune handles a leftover registration, rm clears the files.
      try {
        await runGit(["worktree", "prune"], repoRoot);
      } catch {
        /* ignore */
      }
    }
    fs.rmSync(base, { recursive: true, force: true });
  }
}
