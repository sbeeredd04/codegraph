import { useEffect, type Dispatch, type SetStateAction } from "react";

type Toggle = Dispatch<SetStateAction<boolean>>;

export interface LauncherToggles {
  /** ⌘K / Ctrl+K — node search (command-palette.tsx). */
  readonly setSearch: Toggle;
  /** ⌘⇧P / Ctrl+⇧P — action palette (action-palette.tsx, FR-50). */
  readonly setActions: Toggle;
  /** ⌘Space / Ctrl+Space — command center (command-center.tsx, FR-49). */
  readonly setCenter: Toggle;
}

/**
 * One document-level keydown listener for the explorer's three launcher shortcuts
 * (mod = ⌘ on macOS / Ctrl elsewhere). Opening any one closes the other two so two
 * aria-modal dialogs never stack; Space is matched by `e.code` so IME/layout can't
 * break it. useState setters are stable, so the listener attaches once. Calling
 * setState from a handler is fine — only synchronous setState in an effect body is
 * what the React Compiler lint forbids.
 */
export function useLauncherShortcuts({ setSearch, setActions, setCenter }: LauncherToggles): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (!e.shiftKey && e.code === "Space") {
        e.preventDefault();
        setSearch(false);
        setActions(false);
        setCenter((v) => !v);
      } else if (e.shiftKey && (e.key === "p" || e.key === "P" || e.code === "KeyP")) {
        e.preventDefault();
        setCenter(false);
        setSearch(false);
        setActions((v) => !v);
      } else if (!e.shiftKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setCenter(false);
        setActions(false);
        setSearch((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setSearch, setActions, setCenter]);
}
