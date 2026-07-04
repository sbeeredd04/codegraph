import * as fs from "node:fs";
import * as path from "node:path";
import { ARTIFACT_DIR, type GraphArtifact } from "../../core/report/artifact.js";

// FR-91 — the fs side of the persistent artifact. The pure core (buildGraphArtifact)
// produces the file map; this writes it into `<baseDir>/.codegraph/`. Read-only w.r.t.
// the user's source (FR-9): it only ever creates files under its own dot-dir.

/** Write the artifact's files into `<baseDir>/.codegraph/`, creating the dir if
 *  needed. Returns the absolute artifact directory. */
export function writeGraphArtifact(baseDir: string, artifact: GraphArtifact): string {
  const outDir = path.join(baseDir, ARTIFACT_DIR);
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of artifact.files) {
    fs.writeFileSync(path.join(outDir, file.name), file.content, "utf8");
  }
  return outDir;
}
