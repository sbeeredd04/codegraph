"use client";

// FR-42 — the human-facing mirror of the agent's `codegraph_onboard` playbook.
// The connected agent calls codegraph_onboard over the MCP to get its on-install
// checklist; this renders the SAME pure-core plan (buildOnboardPlaybook) so the
// human can SEE how far the agent has bootstrapped the knowledge layer — which
// starter diagrams/docs/marks already exist, what's still a gap, and the hand-off
// on offer. Read-only chrome (FR-9): it reflects state, it never writes. Surface-
// agnostic — it lives in the dashboard chrome, not a graph lens, so it shows the
// same over the 2D Sigma canvas and the 3D surface.

import type { OnboardPlaybook } from "@core/onboard/playbook";

interface OnboardingPanelProps {
  readonly playbook: OnboardPlaybook;
  readonly onDismiss: () => void;
}

export function OnboardingPanel({ playbook, onDismiss }: OnboardingPanelProps): React.JSX.Element {
  const { steps, done, total, complete } = playbook;
  const next = steps.find((s) => s.status === "todo");
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <section
      role="region"
      aria-label="Onboarding progress"
      data-testid="onboarding-panel"
      className="absolute left-3 top-3 z-20 w-[21rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-zinc-800 bg-[#0c0d11]/97 shadow-2xl backdrop-blur"
    >
      <header className="flex items-center gap-2.5 border-b border-zinc-800/80 px-4 py-3">
        <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-md bg-emerald-500/15 text-emerald-300">
          <CompassIcon />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-sm font-semibold leading-tight text-zinc-100">Onboarding</h2>
          <p className="text-[11px] leading-tight text-zinc-500">Agent bootstrap progress</p>
        </div>
        <span
          data-testid="onboarding-progress"
          className="font-mono text-xs tabular-nums text-zinc-400"
        >
          {done}/{total}
        </span>
        <button
          onClick={onDismiss}
          aria-label="Dismiss onboarding"
          className="ml-0.5 grid size-6 shrink-0 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          <CloseIcon />
        </button>
      </header>

      <div className="px-4 pt-3">
        <div
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Steps complete"
          className="h-1.5 overflow-hidden rounded-full bg-zinc-800"
        >
          <div
            className="h-full rounded-full bg-emerald-500/80 transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <ul role="list" className="flex flex-col gap-0.5 px-2 py-2">
        {steps.map((s) => {
          const isDone = s.status === "done";
          const isNext = !complete && s.id === next?.id;
          return (
            <li
              key={s.id}
              data-step={s.id}
              data-status={s.status}
              className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 ${isNext ? "bg-violet-500/10" : ""}`}
            >
              <span aria-hidden className="mt-px shrink-0">
                {isDone ? <CheckCircle /> : <EmptyCircle />}
              </span>
              <div className="min-w-0">
                <p
                  className={`text-xs font-medium leading-snug ${
                    isDone
                      ? "text-zinc-500 line-through decoration-zinc-700"
                      : isNext
                        ? "text-violet-200"
                        : "text-zinc-200"
                  }`}
                >
                  {s.title}
                  <span className="sr-only">{isDone ? " — done" : " — to do"}</span>
                </p>
                {isNext && <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{s.detail}</p>}
              </div>
            </li>
          );
        })}
      </ul>

      <footer className="border-t border-zinc-800/80 px-4 py-2.5">
        {complete ? (
          <p data-testid="onboarding-handoff" className="text-[11px] leading-snug text-emerald-300/90">
            Starter knowledge layer in place — ask your agent to walk you through it, or explore the board yourself.
          </p>
        ) : (
          <p className="text-[11px] leading-snug text-zinc-500">
            <span className="text-zinc-400">Next:</span> {next?.title}. Your connected agent authors these over the
            codegraph MCP.
          </p>
        )}
      </footer>
    </section>
  );
}

// A small compass glyph — "find your way in", the orientation/onboarding motif.
function CompassIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CloseIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function CheckCircle(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" className="fill-emerald-500/20" />
      <path d="m8 12 2.5 2.5L16 9" stroke="#34d399" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EmptyCircle(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="#52525b" strokeWidth="2" strokeDasharray="3 3" />
    </svg>
  );
}
