// Knowledge-index drawer glue (PM-backlog #4): the browser side of the repo's
// table of contents. Shared browser-only code (like graph-view.ts / diagram-drawer.ts)
// — it touches the DOM, so it lives outside the gate's `src/**` typecheck and is
// covered by the manual webview typecheck. The pure, unit-tested pieces (the escaped
// index markup, the role/category grouping) stay in
// src/adapters/surfaces/webview/knowledge-view.ts.
//
// Roles, summaries, names, and titles are agent-written and therefore UNTRUSTED;
// they are escaped in knowledge-view before they reach innerHTML. This module only
// reads back our own data-* hooks (addresses, diagram ids) to drive navigation.

import {
  knowledgeIndexHtml,
  type KnowledgeIndexModel,
} from "../src/adapters/surfaces/webview/knowledge-view.js";

export interface KnowledgeDrawerEls {
  /** Topbar toggle that opens/closes the drawer. */
  readonly toggle: HTMLButtonElement;
  /** Count badge inside the toggle (number of annotated nodes). */
  readonly toggleCount: HTMLElement;
  /** The slide-over aside. */
  readonly drawer: HTMLElement;
  /** Coverage line in the drawer header. */
  readonly drawerCount: HTMLElement;
  /** Close button in the drawer header. */
  readonly close: HTMLButtonElement;
  /** The index list (role groups + diagram groups). */
  readonly index: HTMLElement;
}

export interface KnowledgeDrawerOptions {
  /** Jump from a node entry to that graph node (the surface owns pan + card). */
  readonly onSelectNode?: (address: string) => void;
  /** Open the diagrams drawer to a diagram by id (deep link from the index). */
  readonly onOpenDiagram?: (id: string) => void;
}

export interface KnowledgeDrawer {
  /** Reconcile the drawer with a fresh knowledge-index model (host repaint / load). */
  update(model: KnowledgeIndexModel): void;
}

function coverageLine(model: KnowledgeIndexModel): string {
  const ann =
    model.totalNodes > 0
      ? `${model.annotatedCount} of ${model.totalNodes} nodes annotated`
      : `${model.annotatedCount} annotated`;
  const dg = `${model.diagramCount} ${model.diagramCount === 1 ? "diagram" : "diagrams"}`;
  return `${ann} · ${dg}`;
}

/**
 * Wire the knowledge-index drawer once and return a controller whose `update` the
 * message loop / load path calls. Owns open/close (toggle, close button, Esc), the
 * escaped index, and click-routing: a node entry focuses its graph node, a diagram
 * entry deep-links the diagrams drawer. Both close this drawer so the navigated-to
 * target isn't obscured by the (right-anchored) panel.
 */
export function createKnowledgeIndex(
  els: KnowledgeDrawerEls,
  opts: KnowledgeDrawerOptions = {},
): KnowledgeDrawer {
  const isOpen = (): boolean => els.drawer.classList.contains("open");
  const setOpen = (open: boolean): void => {
    els.drawer.classList.remove("gone"); // mount on first open so the slide can play
    if (open) requestAnimationFrame(() => els.drawer.classList.add("open"));
    else els.drawer.classList.remove("open");
    els.toggle.classList.toggle("active", open);
    els.toggle.setAttribute("aria-pressed", String(open));
    els.toggle.setAttribute("aria-expanded", String(open));
    // Non-modal drawer (the graph stays interactive): move focus, do not trap it.
    if (open) els.close.focus();
    else els.toggle.focus();
  };

  const wireRows = (): void => {
    for (const b of Array.from(els.index.querySelectorAll<HTMLButtonElement>(".ki-item"))) {
      b.addEventListener("click", () => {
        opts.onSelectNode?.(b.dataset.addr as string);
        setOpen(false);
      });
    }
    for (const b of Array.from(els.index.querySelectorAll<HTMLButtonElement>(".ki-dg"))) {
      b.addEventListener("click", () => {
        setOpen(false);
        opts.onOpenDiagram?.(b.dataset.id as string);
      });
    }
  };

  els.toggle.addEventListener("click", () => setOpen(!isOpen()));
  els.close.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape" && isOpen()) setOpen(false);
  });

  return {
    update(model: KnowledgeIndexModel): void {
      els.toggleCount.textContent = String(model.annotatedCount);
      els.drawerCount.textContent = coverageLine(model);
      els.index.innerHTML = knowledgeIndexHtml(model);
      wireRows();
    },
  };
}
