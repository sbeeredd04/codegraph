import { describe, it, expect } from "vitest";
import {
  buildEditorLink,
  editorById,
  EDITORS,
  DEFAULT_EDITOR,
  type EditorId,
} from "./editor-link.js";

describe("editorById", () => {
  it("resolves a known editor", () => {
    expect(editorById("cursor").scheme).toBe("cursor");
  });

  it("falls back to the default (VS Code) for an unknown/undefined id", () => {
    expect(editorById(undefined).id).toBe(DEFAULT_EDITOR);
    expect(editorById("nope" as EditorId).id).toBe(DEFAULT_EDITOR);
  });

  it("every registered editor has a distinct scheme", () => {
    const schemes = EDITORS.map((e) => e.scheme);
    expect(new Set(schemes).size).toBe(schemes.length);
  });
});

describe("buildEditorLink", () => {
  it("builds a vscode://file link with a 1-based line and column from 0-based input", () => {
    const link = buildEditorLink({
      root: "/Users/me/proj",
      file: "src/a.ts",
      line: 9,
      column: 4,
    });
    expect(link).toBe("vscode://file/Users/me/proj/src/a.ts:10:5");
  });

  it("omits the column when only a line is given", () => {
    expect(buildEditorLink({ root: "/r", file: "a.ts", line: 0 })).toBe(
      "vscode://file/r/a.ts:1",
    );
  });

  it("omits the position entirely when no line is given", () => {
    expect(buildEditorLink({ root: "/r", file: "a.ts" })).toBe("vscode://file/r/a.ts");
  });

  it("uses the requested editor's scheme", () => {
    expect(buildEditorLink({ editor: "cursor", root: "/r", file: "a.ts", line: 0 })).toBe(
      "cursor://file/r/a.ts:1",
    );
    expect(
      buildEditorLink({ editor: "windsurf", root: "/r", file: "a.ts", line: 0 }),
    ).toBe("windsurf://file/r/a.ts:1");
  });

  it("strips a trailing slash on the root and a leading ./ on the file", () => {
    expect(buildEditorLink({ root: "/Users/me/proj/", file: "./src/a.ts", line: 2 })).toBe(
      "vscode://file/Users/me/proj/src/a.ts:3",
    );
  });

  it("handles a Windows absolute root by prepending a single slash", () => {
    expect(
      buildEditorLink({ root: "C:\\Users\\me\\proj", file: "src\\a.ts", line: 0 }),
    ).toBe("vscode://file/C:/Users/me/proj/src/a.ts:1");
  });

  it("percent-encodes spaces and unsafe characters but keeps separators", () => {
    expect(
      buildEditorLink({ root: "/Users/My Code", file: "a b/c#d.ts", line: 0 }),
    ).toBe("vscode://file/Users/My%20Code/a%20b/c%23d.ts:1");
  });

  // Source-blindness / safety: no link when the host root is unknown.
  it("returns null without an absolute root (AD-14: cloud plane stays source-blind)", () => {
    expect(buildEditorLink({ root: null, file: "a.ts", line: 0 })).toBeNull();
    expect(buildEditorLink({ root: undefined, file: "a.ts", line: 0 })).toBeNull();
    expect(buildEditorLink({ root: "", file: "a.ts", line: 0 })).toBeNull();
    expect(buildEditorLink({ root: "relative/root", file: "a.ts", line: 0 })).toBeNull();
  });

  it("returns null for an empty file", () => {
    expect(buildEditorLink({ root: "/r", file: "", line: 0 })).toBeNull();
    expect(buildEditorLink({ root: "/r", file: "   ", line: 0 })).toBeNull();
  });

  it("returns null for an absolute file (won't be re-rooted)", () => {
    expect(buildEditorLink({ root: "/r", file: "/etc/passwd", line: 0 })).toBeNull();
    expect(buildEditorLink({ root: "/r", file: "C:/Windows/x", line: 0 })).toBeNull();
  });

  it("returns null for a file that escapes the root via ..", () => {
    expect(buildEditorLink({ root: "/r", file: "../secret.ts", line: 0 })).toBeNull();
    expect(buildEditorLink({ root: "/r", file: "src/../../secret.ts", line: 0 })).toBeNull();
  });

  it("ignores a negative or non-integer line rather than emitting a bad suffix", () => {
    expect(buildEditorLink({ root: "/r", file: "a.ts", line: -1 })).toBe(
      "vscode://file/r/a.ts",
    );
    expect(buildEditorLink({ root: "/r", file: "a.ts", line: 1.5 })).toBe(
      "vscode://file/r/a.ts",
    );
  });

  it("drops a stray . segment in the file path", () => {
    expect(buildEditorLink({ root: "/r", file: "src/./a.ts", line: 0 })).toBe(
      "vscode://file/r/src/a.ts:1",
    );
  });
});
