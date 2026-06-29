// FR-51-deferred: resolve the user's reduced-motion preference. The 3D camera
// tweens (FR-47 Reset/Fit/node-framing + FR-48 movie) and BOTH surfaces' guided
// replay (FR-40) collapse to the final state under reduced motion. "auto" follows
// the OS `prefers-reduced-motion`; "on"/"off" are explicit in-app overrides from
// Settings, so a user can force calm motion — or keep animation — regardless of the
// OS setting. matchMedia is read LIVE (per call), so a tween started after the OS
// toggles still picks up the change. Frontend-only (touches window); no core import.

export type ReduceMotionPref = "auto" | "on" | "off";

/** The OS preference (false when there is no window — SSR-safe). */
export function osPrefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/** Resolve the effective reduced-motion flag from the user override + the OS. */
export function resolveReducedMotion(pref: ReduceMotionPref | undefined): boolean {
  if (pref === "on") return true;
  if (pref === "off") return false;
  return osPrefersReducedMotion(); // "auto" (or unset) → follow the system
}
