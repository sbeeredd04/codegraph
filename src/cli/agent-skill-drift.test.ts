import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildAgentSkill } from "../core/skill/agent-skill.js";

// The committed `agent-skill/SKILL.md` is a GENERATED artifact — the source of truth
// is buildAgentSkill(). This guard fails if someone hand-edits the file or forgets to
// regenerate after changing the builder, so the shipped skill and the CLI's `codegraph
// skill` output can never disagree. Lives beside the CLI (not in src/core) because it
// reads the filesystem, which core purity forbids.
describe("agent-skill/SKILL.md drift (FR-92)", () => {
  it("matches buildAgentSkill() — regenerate with `npx codegraph skill` on change", () => {
    const committed = fs.readFileSync(
      path.join(process.cwd(), "agent-skill", "SKILL.md"),
      "utf8",
    );
    expect(committed).toBe(buildAgentSkill());
  });
});
