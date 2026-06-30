"use client";

// FR-70 — the CodeMirror 6 source surface. A REAL editor engine (language-aware
// highlighting, a line gutter, the defining line marked + scrolled to centre) that
// replaces the hand-rolled <pre> tokenizer. CM6 is the deliberate choice over
// Monaco: it is eval-free (no Function ctor, no blob workers) so it boots under the
// strict no-eval webview CSP, and its styles are injected as inline <style> which
// `style-src 'unsafe-inline'` permits — proven by `cm-csp-smoke`. The whole engine
// is dynamic-imported here so it never weighs on the boot path.
//
// Read-only by DEFAULT (FR-9): editing is gated per plane by the caller — the
// website/cloud stays view-only (there's no source there anyway, AD-14), the VS
// Code extension edits through the real editor (FR-31/FR-32, never a silent write),
// and a connected-local bridge may pass `editable`+`onSave` for an EXPLICIT save.
// Untrusted source is safe: CM6 sets text as document content, never as HTML.

import { useEffect, useRef, useState } from "react";

export interface CodeSurfaceProps {
  /** The file's source text (host-local bytes, AD-16). */
  readonly text: string;
  /** 0-based line where the node is defined — marked + scrolled to centre. */
  readonly anchorLine: number;
  /** The node's file path — picks the language grammar + labels the region. */
  readonly fileName: string;
  /** Allow edits. Default false (view-only). Only a plane that owns the bytes and
   * can persist an EXPLICIT save should pass true (never a silent write, FR-9). */
  readonly editable?: boolean;
  /** Persist an edit (Cmd/Ctrl-S). Required for `editable` to do anything useful. */
  readonly onSave?: (next: string) => void;
}

/** Dynamic-load only the grammar this file needs (keeps the editor chunk lean). */
async function loadLanguage(fileName: string): Promise<unknown | null> {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"].includes(ext)) {
    const { javascript } = await import("@codemirror/lang-javascript");
    const typescript = ext.startsWith("ts") || ext === "mts" || ext === "cts";
    const jsx = ext === "tsx" || ext === "jsx";
    return javascript({ typescript, jsx });
  }
  if (ext === "py") {
    const { python } = await import("@codemirror/lang-python");
    return python();
  }
  return null;
}

export function CodeSurface({
  text,
  anchorLine,
  fileName,
  editable = false,
  onSave,
}: CodeSurfaceProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready">("loading");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let destroy: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      // Core engine (eval-free) + the matching grammar, all off the boot path.
      const [stateMod, viewMod, langMod, cmdMod, hlMod, lang] = await Promise.all([
        import("@codemirror/state"),
        import("@codemirror/view"),
        import("@codemirror/language"),
        import("@codemirror/commands"),
        import("@lezer/highlight"),
        loadLanguage(fileName),
      ]);
      if (cancelled) return;

      const { EditorState, StateField } = stateMod;
      const { EditorView, lineNumbers, keymap, Decoration } = viewMod;
      const { syntaxHighlighting, HighlightStyle } = langMod;
      const { history, defaultKeymap, historyKeymap, indentWithTab } = cmdMod;
      const { tags: t } = hlMod;

      // Brand-matched dark theme + token palette (continues the prior viewer's
      // violet/emerald/amber so the swap is visually seamless).
      const theme = EditorView.theme(
        {
          "&": { height: "100%", backgroundColor: "transparent", color: "#d4d4d8" },
          "&.cm-focused": { outline: "none" },
          ".cm-scroller": {
            fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, monospace",
            fontSize: "12px",
            lineHeight: "1.55",
            overflow: "auto",
          },
          ".cm-content": { padding: "8px 0" },
          ".cm-gutters": { backgroundColor: "#0b0c10", color: "#52525b", border: "none" },
          ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 14px", minWidth: "2ch" },
          ".cm-defline": { backgroundColor: "rgba(139,92,246,0.12)" },
          ".cm-defline .cm-gutterElement, .cm-defline-gutter": { color: "#c4b5fd" },
          ".cm-cursor": { borderLeftColor: "#c4b5fd" },
          "::selection": { backgroundColor: "rgba(139,92,246,0.25)" },
          ".cm-selectionBackground": { backgroundColor: "rgba(139,92,246,0.25) !important" },
        },
        { dark: true },
      );
      const highlight = syntaxHighlighting(
        HighlightStyle.define([
          { tag: t.keyword, color: "#c4b5fd" },
          { tag: [t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: "#c4b5fd" },
          { tag: [t.string, t.special(t.string)], color: "#6ee7b7" },
          { tag: [t.number, t.bool, t.null, t.atom], color: "#fcd34d" },
          { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "#71717a", fontStyle: "italic" },
          { tag: [t.typeName, t.className, t.namespace], color: "#7dd3fc" },
          { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#93c5fd" },
          { tag: [t.definitionKeyword, t.modifier], color: "#f0abfc" },
          { tag: t.propertyName, color: "#d4d4d8" },
          { tag: [t.operator, t.punctuation, t.bracket], color: "#9ca3af" },
          { tag: t.invalid, color: "#f87171" },
        ]),
      );

      // The defining line, marked once (read-only doc → the field never updates).
      const safeLine = anchorLine >= 0 ? Math.min(anchorLine, Math.max(text.split("\n").length - 1, 0)) : 0;
      const defField = StateField.define({
        create(s) {
          if (s.doc.lines === 0) return Decoration.none;
          const line = s.doc.line(safeLine + 1);
          return Decoration.set([Decoration.line({ attributes: { class: "cm-defline" } }).range(line.from)]);
        },
        update(v) {
          return v;
        },
        provide: (f) => EditorView.decorations.from(f),
      });

      // Edit gate: editable adds history + a Mod-s that calls onSave EXPLICITLY;
      // otherwise the doc is read-only (selection + copy still work).
      const editExtensions = editable
        ? [
            history(),
            keymap.of([
              ...defaultKeymap,
              ...historyKeymap,
              indentWithTab,
              {
                key: "Mod-s",
                preventDefault: true,
                run: (v: { state: { doc: { toString(): string } } }) => {
                  onSave?.(v.state.doc.toString());
                  return true;
                },
              },
            ]),
          ]
        : [EditorState.readOnly.of(true), EditorView.editable.of(false)];

      const extensions = [
        lineNumbers(),
        theme,
        highlight,
        defField,
        EditorView.lineWrapping,
        ...(lang ? [lang as never] : []),
        ...editExtensions,
      ];

      const view = new EditorView({
        state: EditorState.create({ doc: text, extensions }),
        parent: host,
      });
      destroy = () => view.destroy();

      // Centre the def line once the layout exists.
      const pos = view.state.doc.line(safeLine + 1).from;
      view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "center" }) });
      setStatus("ready");
    })();

    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [text, anchorLine, fileName, editable, onSave]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={hostRef}
        data-testid="code-surface"
        data-editable={editable ? "true" : "false"}
        aria-label={`Source code for ${fileName}`}
        className="h-full w-full"
      />
      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-zinc-600">
          Rendering source…
        </div>
      )}
    </div>
  );
}
