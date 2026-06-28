"use client";

// FR-39: the user-sovereignty preempt banner. When the connected agent DRIVES the
// board (a presentation command lands), this floats at the top so the human always
// knows control was handed off — and can take it back with one click. The agent is
// a co-pilot, never the owner of the wheel; dismissing here clears the agent's
// transient highlight and returns the surface to the user.

interface PresentingBannerProps {
  /** A short, escaped description of what the agent just did (React-escaped). */
  readonly action: string;
  /** Take back control — clears the agent's highlight and hides the banner. */
  readonly onDismiss: () => void;
}

export function PresentingBanner({ action, onDismiss }: PresentingBannerProps): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-violet-500/40 bg-violet-500/10 py-1.5 pl-3 pr-1.5 text-xs text-violet-100 shadow-lg shadow-black/30 backdrop-blur">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-2 animate-ping rounded-full bg-violet-400 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-violet-400" />
        </span>
        <span className="font-medium">
          The agent is presenting
          <span className="ml-1 font-normal text-violet-300/80">· {action}</span>
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-full border border-violet-400/40 bg-violet-500/20 px-2.5 py-1 font-medium text-violet-50 transition-colors hover:bg-violet-500/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
        >
          Take control
        </button>
      </div>
    </div>
  );
}
