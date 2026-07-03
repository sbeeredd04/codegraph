"use client";

// FR-55 cap-relief extraction — the Explorer's overlay dialogs + knowledge
// drawers, pulled out of explorer.tsx so the shell stays under the file-size cap.
// Each is a self-contained surface gated by its own `*Open` flag: the ⌘K node
// palette, the ⌘⇧P action palette, the ⌘Space command center, the settings sheet,
// the diagrams/docs drawers, and the AI-assist Ask panel. Purely presentational —
// every flag, datum, and callback is owned by the shell (single source of truth);
// no view state lives here. Drawer instances are keyed on `layoutVersion` so Reset
// Layout remounts them to defaults, exactly as before the extraction.

import { useMemo } from "react";
import type { GraphNode } from "@core/graph/types";
import type { SearchableNode } from "@core/search/node-search";
import type { Diagram } from "@core/diagrams/diagram";
import type { Doc } from "@core/docs/doc";
import type { AskFocus } from "@core/assist/ask";
import type { ExplorerSettings } from "@/lib/settings";
import { CommandPalette } from "./command-palette";
import { ActionPalette, type PaletteAction } from "./action-palette";
import { CommandCenter } from "./command-center";
import { SettingsPanel } from "./settings-panel";
import { DiagramsDrawer } from "./diagrams-drawer";
import { DocsDrawer } from "./docs-drawer";
import { AskPanel } from "./ask-panel";
import { IngestPanel } from "./ingest-panel";
import type { IngestController } from "@/lib/use-ingest";

interface ExplorerDialogsProps {
  readonly nodes: readonly GraphNode[];
  readonly byAddress: ReadonlyMap<string, GraphNode>;
  readonly diagramList: readonly Diagram[];
  readonly docList: readonly Doc[];
  /** Remount key — Reset Layout bumps it so drawers return to default size/pos. */
  readonly layoutVersion: number;
  readonly jumpTo: (address: string) => void;
  readonly buildActions: () => readonly PaletteAction[];
  // Settings
  readonly settings: ExplorerSettings;
  readonly changeSetting: (patch: Partial<ExplorerSettings>) => void;
  readonly resetSettings: () => void;
  // AI-assist Ask (local plane only)
  readonly assistEnabled: boolean;
  readonly askFocus: AskFocus | null;
  readonly askNeighbours: readonly string[];
  readonly title: string;
  // Open flags + their close handlers (the shell owns the state)
  readonly paletteOpen: boolean;
  readonly closePalette: () => void;
  readonly actionsOpen: boolean;
  readonly closeActions: () => void;
  readonly centerOpen: boolean;
  readonly closeCenter: () => void;
  readonly settingsOpen: boolean;
  readonly closeSettings: () => void;
  readonly diagramsOpen: boolean;
  readonly onCloseDiagrams: () => void;
  readonly docsOpen: boolean;
  readonly onCloseDocs: () => void;
  readonly askOpen: boolean;
  readonly onCloseAsk: () => void;
  /** Live repo-ingestion controller (FR-55) — drives the floating progress panel. */
  readonly ingest: IngestController;
}

export function ExplorerDialogs({
  nodes,
  byAddress,
  diagramList,
  docList,
  layoutVersion,
  jumpTo,
  buildActions,
  settings,
  changeSetting,
  resetSettings,
  assistEnabled,
  askFocus,
  askNeighbours,
  title,
  paletteOpen,
  closePalette,
  actionsOpen,
  closeActions,
  centerOpen,
  closeCenter,
  settingsOpen,
  closeSettings,
  diagramsOpen,
  onCloseDiagrams,
  docsOpen,
  onCloseDocs,
  askOpen,
  onCloseAsk,
  ingest,
}: ExplorerDialogsProps): React.JSX.Element {
  // FR-74: the searchable view carries each node's file PATH so the launchers can
  // show it as a secondary line (distinguishes same-named symbols) and the kind so
  // the `fn:`/`file:`/`class:` scopes work. Path metadata only — safe on the
  // source-blind plane (AD-14). Memoised so it rebuilds only when the graph does.
  const searchableNodes: readonly SearchableNode[] = useMemo(
    () => nodes.map((n) => ({ address: n.address, name: n.name, kind: n.kind, path: n.location.file })),
    [nodes],
  );
  return (
    <>
      {/* ⌘K command palette (Story 8.4) — fuzzy jump-to-node */}
      {paletteOpen && <CommandPalette nodes={searchableNodes} onClose={closePalette} onSelect={jumpTo} />}

      {/* ⌘⇧P action palette (FR-50) — fuzzy run-an-action, distinct from ⌘K */}
      {actionsOpen && <ActionPalette build={buildActions} onClose={closeActions} />}

      {/* ⌘Space command center (FR-49) — unified node + action launcher */}
      {centerOpen && (
        <CommandCenter nodes={searchableNodes} buildActions={buildActions} onSelectNode={jumpTo} onClose={closeCenter} />
      )}

      {/* Settings (FR-51) — persisted board preferences, applied live */}
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onChange={changeSetting}
          onReset={resetSettings}
          onClose={closeSettings}
        />
      )}

      {/* Knowledge diagrams drawer (FR-28) — Related chips jump into the graph */}
      {diagramsOpen && (
        <DiagramsDrawer
          key={layoutVersion}
          diagrams={diagramList}
          byAddress={byAddress}
          onJump={jumpTo}
          onClose={onCloseDiagrams}
        />
      )}

      {/* Knowledge docs drawer (FR-29) — sanitized Markdown + node deep-links */}
      {docsOpen && (
        <DocsDrawer
          key={layoutVersion}
          docs={docList}
          byAddress={byAddress}
          onJump={jumpTo}
          onClose={onCloseDocs}
        />
      )}

      {/* AI-assist "Ask" panel (FR-30) — builds a prompt for the user's agent */}
      {assistEnabled && askOpen && (
        <AskPanel focus={askFocus} neighbours={askNeighbours} root={title} onClose={onCloseAsk} />
      )}

      {/* FR-55: live repo-ingestion progress — shown while a scan runs (user "Index"
          trigger or the agent) or after it settles. Driven by useIngest (host
          stream + dev `__ingest` hook); chrome over both surfaces. */}
      {ingest.visible && (
        <IngestPanel
          view={ingest.view}
          file={ingest.state.file}
          onIndex={ingest.index}
          onDismiss={ingest.dismiss}
        />
      )}
    </>
  );
}
