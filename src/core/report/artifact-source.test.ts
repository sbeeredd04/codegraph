import { describe, it, expect } from "vitest";
import { decideGraphSource } from "./artifact-source.js";

describe("decideGraphSource (FR-93)", () => {
  it("scans when there is no artifact", () => {
    const d = decideGraphSource({ artifactAvailable: false });
    expect(d.mode).toBe("scan");
    expect(d.stale).toBe(false);
  });

  it("loads a fresh artifact by default (skips the scan)", () => {
    const d = decideGraphSource({
      artifactAvailable: true,
      artifactMtimeMs: 2000,
      newestSourceMtimeMs: 1000, // source older than the artifact → fresh
    });
    expect(d.mode).toBe("artifact");
    expect(d.stale).toBe(false);
  });

  it("auto-rescans when the artifact is older than the source", () => {
    const d = decideGraphSource({
      artifactAvailable: true,
      artifactMtimeMs: 1000,
      newestSourceMtimeMs: 2000, // a source file changed after the artifact was built
    });
    expect(d.mode).toBe("scan");
    expect(d.stale).toBe(true);
    expect(d.reason).toMatch(/older than the source/);
  });

  it("--from-artifact pins a fresh artifact", () => {
    const d = decideGraphSource({
      artifactAvailable: true,
      forceArtifact: true,
      artifactMtimeMs: 2000,
      newestSourceMtimeMs: 1000,
    });
    expect(d.mode).toBe("artifact");
    expect(d.stale).toBe(false);
    expect(d.reason).toContain("--from-artifact");
  });

  it("--from-artifact serves even a stale artifact, but flags it", () => {
    const d = decideGraphSource({
      artifactAvailable: true,
      forceArtifact: true,
      artifactMtimeMs: 1000,
      newestSourceMtimeMs: 2000,
    });
    expect(d.mode).toBe("artifact");
    expect(d.stale).toBe(true);
    expect(d.reason).toMatch(/stale|older/i);
  });

  it("--from-artifact falls back to a scan when there is no artifact", () => {
    const d = decideGraphSource({ artifactAvailable: false, forceArtifact: true });
    expect(d.mode).toBe("scan");
  });

  it("--rescan scans even when a fresh artifact exists", () => {
    const d = decideGraphSource({
      artifactAvailable: true,
      forceRescan: true,
      artifactMtimeMs: 2000,
      newestSourceMtimeMs: 1000,
    });
    expect(d.mode).toBe("scan");
    expect(d.reason).toMatch(/rescan/i);
  });

  it("treats an unknown source mtime as not-stale (won't rescan on missing info)", () => {
    const d = decideGraphSource({
      artifactAvailable: true,
      artifactMtimeMs: 1000,
      newestSourceMtimeMs: undefined,
    });
    expect(d.mode).toBe("artifact");
    expect(d.stale).toBe(false);
  });
});
