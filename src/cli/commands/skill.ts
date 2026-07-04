import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildAgentSkill, AGENT_SKILL_NAME } from "../../core/skill/agent-skill.js";
import type { CliCommand } from "../runtime.js";

/** FR-92: emit the codegraph agent skill so a connected agent reaches for the graph
 *  before it greps. Prints to stdout by default (pipe it anywhere); `--install` writes
 *  it under the user's ~/.claude/skills (they ran the command, so they consent). */
function runSkill(install: boolean): void {
  const markdown = buildAgentSkill();
  if (!install) {
    process.stdout.write(markdown);
    return;
  }
  const dir = path.join(os.homedir(), ".claude", "skills", AGENT_SKILL_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, "SKILL.md");
  fs.writeFileSync(target, markdown, "utf8");
  process.stderr.write(`codegraph: installed agent skill to ${target}\n`);
}

export const skillCommand: CliCommand = {
  name: "skill",
  usage: "codegraph skill [--install]",
  summary: "print the agent skill (SKILL.md); --install writes ~/.claude/skills/codegraph/SKILL.md",
  run: (inv) => runSkill(inv.flags.has("--install")),
};
