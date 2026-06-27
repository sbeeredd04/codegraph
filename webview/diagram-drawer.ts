// Diagrams drawer glue (Epic 7): the browser side of the agent-authored Mermaid
// knowledge diagrams. Shared browser-only code (like graph-view.ts) — it touches
// the DOM and the vendored Mermaid global, so it lives outside the gate's `src/**`
// typecheck and is covered by the manual webview typecheck (tsconfig.webview.json).
// The pure, unit-tested pieces (the escaped index markup, the category grouping)
// stay in src/adapters/surfaces/webview/diagram-view.ts.
//
// The Mermaid SOURCE is agent-written and therefore UNTRUSTED. It is rendered with
// Mermaid's strict security level (no raw HTML, no inline scripts, no click
// bindings), and every piece of chrome we inject ourselves (title, category, error
// text, the source echo) is escaped. A render failure degrades to an inline error
// with the offending source — never a thrown exception or a blank panel.

import {
  diagramIndexHtml,
  relatedChipsHtml,
  type DiagramPanelModel,
  type DiagramView,
} from "../src/adapters/surfaces/webview/diagram-view.js";
import { esc } from "../src/adapters/surfaces/webview/card.js";

export interface DiagramDrawerEls {
  /** Topbar toggle that opens/closes the drawer. */
  readonly toggle: HTMLButtonElement;
  /** Count badge inside the toggle. */
  readonly toggleCount: HTMLElement;
  /** The slide-over aside. */
  readonly drawer: HTMLElement;
  /** Count line in the drawer header. */
  readonly drawerCount: HTMLElement;
  /** Close button in the drawer header. */
  readonly close: HTMLButtonElement;
  /** The category/diagram index list. */
  readonly index: HTMLElement;
  /** Selected diagram's title + category. */
  readonly stageHead: HTMLElement;
  /** Clickable chips for the open diagram's related graph nodes (Epic 7.5c). */
  readonly related: HTMLElement;
  /** Where the rendered Mermaid SVG is injected. */
  readonly render: HTMLElement;
}

export interface DiagramDrawerOptions {
  /** Jump from a diagram's "related" chip to that graph node. The surface owns the
   * focus (pan camera + show card); the drawer closes so the node is unobscured. */
  readonly onSelectNode?: (address: string) => void;
}

export interface DiagramDrawer {
  /** Reconcile the drawer with a fresh diagram panel model (host repaint). */
  update(model: DiagramPanelModel): void;
}

// The esbuild ESM-global build exposes the API at `.mermaid.default`; fall back to
// a plain `window.mermaid` in case a future build ships a cleaner global.
function resolveMermaid(): MermaidApi | undefined {
  return window.__esbuild_esm_mermaid_nm?.mermaid?.default ?? window.mermaid;
}

/**
 * Wire the Diagrams drawer once and return a controller whose `update` the message
 * loop calls on every host repaint. Owns: open/close (toggle, close button, Esc),
 * the escaped index, selection state (kept across live updates), and the defensive
 * Mermaid render.
 */
export function createDiagramDrawer(
  els: DiagramDrawerEls,
  opts: DiagramDrawerOptions = {},
): DiagramDrawer {
  const byId = new Map<string, DiagramView>();
  let current: string | undefined;
  let renderSeq = 0;
  let mermaidReady = false;

  const ensureMermaid = (): MermaidApi | undefined => {
    const mermaid = resolveMermaid();
    if (mermaid && !mermaidReady) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict", // agent source is untrusted: no raw HTML/script/clicks
        theme: "dark",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        flowchart: { htmlLabels: false, useMaxWidth: true },
        themeVariables: { fontSize: "13px" },
      });
      mermaidReady = true;
    }
    return mermaid;
  };

  const isOpen = (): boolean => els.drawer.classList.contains("open");
  const setOpen = (open: boolean): void => {
    els.drawer.classList.remove("gone"); // mount on first open so the slide can play
    if (open) requestAnimationFrame(() => els.drawer.classList.add("open"));
    else els.drawer.classList.remove("open");
    els.toggle.classList.toggle("active", open);
    els.toggle.setAttribute("aria-pressed", String(open));
    els.toggle.setAttribute("aria-expanded", String(open));
    // Non-modal drawer (the graph stays interactive), so we move focus but do not
    // trap it: focus the close button on open, restore the toggle on close.
    if (open) els.close.focus();
    else els.toggle.focus();
  };

  const renderDiagram = async (view: DiagramView): Promise<void> => {
    els.stageHead.hidden = false;
    els.stageHead.innerHTML =
      `<h4>${esc(view.title)}</h4><span class="cat">${esc(view.category)}</span>`;
    const mermaid = ensureMermaid();
    if (!mermaid) {
      els.render.innerHTML =
        `<div class="dg-err"><b>Mermaid failed to load.</b>Reload the panel and try again.</div>`;
      return;
    }
    const seq = ++renderSeq;
    const id = `mmd-${seq}`;
    try {
      const { svg } = await mermaid.render(id, view.mermaid);
      if (seq !== renderSeq) return; // a newer selection won the race — drop this result
      els.render.innerHTML = svg; // strict-mode SVG, already sanitized by Mermaid
    } catch (err) {
      if (seq !== renderSeq) return;
      const msg = err instanceof Error ? err.message : String(err);
      els.render.innerHTML =
        `<div class="dg-err"><b>This diagram could not be rendered.</b>` +
        `${esc(msg)}<pre>${esc(view.mermaid)}</pre></div>`;
    } finally {
      // Mermaid can leave a stray off-screen error node behind on a parse failure.
      document.getElementById(`d${id}`)?.remove();
    }
  };

  const markActive = (id: string): void => {
    for (const b of Array.from(els.index.querySelectorAll<HTMLElement>(".dg-item"))) {
      b.classList.toggle("active", b.dataset.id === id);
    }
  };

  // Related-node chips (Epic 7.5c): only shown when the diagram names addresses AND
  // the surface gave us a way to focus them. Clicking jumps to the node and closes
  // the drawer so the (right-anchored) panel doesn't cover the node we panned to.
  const renderRelated = (view: DiagramView): void => {
    const html = opts.onSelectNode ? relatedChipsHtml(view.related) : "";
    if (!html) {
      els.related.hidden = true;
      els.related.innerHTML = "";
      return;
    }
    els.related.hidden = false;
    els.related.innerHTML = html;
    for (const b of Array.from(els.related.querySelectorAll<HTMLButtonElement>(".dg-rel"))) {
      b.addEventListener("click", () => {
        opts.onSelectNode?.(b.dataset.addr as string);
        setOpen(false);
      });
    }
  };

  const clearRelated = (): void => {
    els.related.hidden = true;
    els.related.innerHTML = "";
  };

  const select = (id: string): void => {
    const view = byId.get(id);
    if (!view) return;
    current = id;
    markActive(id);
    renderRelated(view);
    void renderDiagram(view);
  };

  els.toggle.addEventListener("click", () => setOpen(!isOpen()));
  els.close.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape" && isOpen()) setOpen(false);
  });

  return {
    update(model: DiagramPanelModel): void {
      byId.clear();
      for (const group of model.groups) for (const d of group.diagrams) byId.set(d.id, d);
      els.toggleCount.textContent = String(model.count);
      els.drawerCount.textContent = `${model.count} ${model.count === 1 ? "diagram" : "diagrams"}`;

      if (model.count === 0) {
        els.index.hidden = true;
        els.stageHead.hidden = true;
        clearRelated();
        els.render.innerHTML = diagramIndexHtml(model); // onboarding empty state
        current = undefined;
        return;
      }

      els.index.hidden = false;
      els.index.innerHTML = diagramIndexHtml(model);
      for (const b of Array.from(els.index.querySelectorAll<HTMLButtonElement>(".dg-item"))) {
        b.addEventListener("click", () => select(b.dataset.id as string));
      }

      // Keep the current selection across a live update if it still exists, so a
      // background re-scan never yanks the diagram the user is reading. Otherwise
      // wait for an explicit pick rather than guessing.
      if (current && byId.has(current)) select(current);
      else {
        current = undefined;
        els.stageHead.hidden = true;
        clearRelated();
        els.render.innerHTML = `<p class="dg-placeholder">Select a diagram to render it.</p>`;
      }
    },
  };
}
