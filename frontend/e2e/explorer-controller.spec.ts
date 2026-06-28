import { test, expect, type Page } from "@playwright/test";

// FR-43 (Epic 19): the generalized surface controller. Both the 2D Sigma canvas
// and the 3D canvas expose an imperative {focus,frame,highlight,replay} handle so
// the host — and, through the FR-39 command bus to come, the user's agent — can
// DRIVE the surface. These tests drive it through the dev-only `__controller` hook
// (present on the dev server, tree-shaken from the static export) and assert the
// painted result on EACH substrate.

const SEEDED = "ts:src/adapters/cache/repo-cache.ts#repoCacheFile"; // carries a hotspot mark
const OTHER = "ts:src/core/graph/export.ts";
// Mirrors frontend/lib/overlay-style.ts.
const HIGHLIGHT_ACCENT = "#a78bfa"; // the default driver-highlight colour
const MARK_HOTSPOT = "#fb923c"; // SEEDED's persistent mark, restored when highlight clears

// Gate on a real codegraph node so each test starts from the settled dataset (not
// the still-mounted default trpc graph) — see explorer-overlays.spec.ts.
async function waitForNode(page: Page, address: string): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((addr) => {
          const el = document.querySelector("div.absolute.inset-0") as
            | (HTMLElement & { __sigma?: { getGraph(): { hasNode(id: string): boolean } } })
            | null;
          return el?.__sigma ? el.__sigma.getGraph().hasNode(addr) : false;
        }, address),
      { timeout: 30_000 },
    )
    .toBe(true);
}

type Method = "focus" | "frame" | "highlight";

/** Drive a controller method on the mounted surface via the dev `__controller`
 * hook. Returns false if the controller isn't installed yet. */
async function drive(page: Page, surface: "2d" | "3d", method: Method, addresses: string[]): Promise<boolean> {
  const selector = surface === "3d" ? '[data-surface="3d"]' : "div.absolute.inset-0";
  return page.evaluate(
    ({ selector, method, addresses }) => {
      const el = document.querySelector(selector) as
        | (HTMLElement & { __controller?: Record<string, (a: string[]) => void> })
        | null;
      const c = el?.__controller;
      if (!c || typeof c[method] !== "function") return false;
      c[method](addresses);
      return true;
    },
    { selector, method, addresses },
  );
}

/** The 2D node's post-reducer display colour (what the surface actually painted). */
async function color2d(page: Page, address: string): Promise<string | null> {
  return page.evaluate((addr) => {
    const el = document.querySelector("div.absolute.inset-0") as
      | (HTMLElement & { __sigma?: { getNodeDisplayData(id: string): { color?: string } | undefined } })
      | null;
    const d = el?.__sigma?.getNodeDisplayData(addr);
    return d?.color ? d.color.toLowerCase() : null;
  }, address);
}

/** The 3D node's overlay-resolved draw colour, via the dev __overlay3d hook. */
async function color3d(page: Page, address: string): Promise<string | null> {
  return page.evaluate((addr) => {
    const el = document.querySelector('[data-surface="3d"]') as
      | (HTMLElement & { __overlay3d?: (a: string) => string | null })
      | null;
    const c = el?.__overlay3d?.(addr) ?? null;
    return c ? c.toLowerCase() : null;
  }, address);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Dataset").selectOption("codegraph");
  await waitForNode(page, SEEDED);
});

test("the controller drives a transient highlight on the 2D surface (FR-43)", async ({ page }) => {
  // A driven highlight is the topmost layer: it overrides even SEEDED's persistent
  // hotspot mark, so the agent's live pointer is never lost under an annotation.
  expect(await drive(page, "2d", "highlight", [SEEDED])).toBe(true);
  await expect.poll(() => color2d(page, SEEDED), { timeout: 10_000 }).toBe(HIGHLIGHT_ACCENT);

  // Clearing the highlight (empty set) restores the ambient mark tint underneath.
  expect(await drive(page, "2d", "highlight", [])).toBe(true);
  await expect.poll(() => color2d(page, SEEDED), { timeout: 10_000 }).toBe(MARK_HOTSPOT);
});

test("focus selects a node; frame moves the camera without selecting (FR-43)", async ({ page }) => {
  // Nothing is selected at rest — the detail panel is absent.
  await expect(page.getByTestId("detail-body")).toHaveCount(0);

  // frame() is camera-only: it must NOT open the detail panel.
  expect(await drive(page, "2d", "frame", [OTHER])).toBe(true);
  await expect(page.getByTestId("detail-body")).toHaveCount(0);

  // focus() selects the set's head — the detail panel opens for it.
  expect(await drive(page, "2d", "focus", [OTHER])).toBe(true);
  await expect(page.getByTestId("detail-body")).toBeVisible();
});

test("the controller drives the same highlight on the 3D surface (FR-43 parity)", async ({ page }) => {
  await page.getByRole("button", { name: "3d", exact: true }).click();
  await expect(page.locator('[data-surface="3d"] canvas')).toBeVisible();
  // Wait for the 3D scene + controller to settle.
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Boolean(
            (document.querySelector('[data-surface="3d"]') as (HTMLElement & { __controller?: unknown }) | null)
              ?.__controller,
          ),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);

  // Same precedence as 2D: the highlight wins over SEEDED's hotspot mark, then
  // clearing it restores the mark.
  expect(await drive(page, "3d", "highlight", [SEEDED])).toBe(true);
  await expect.poll(() => color3d(page, SEEDED), { timeout: 10_000 }).toBe(HIGHLIGHT_ACCENT);
  expect(await drive(page, "3d", "highlight", [])).toBe(true);
  await expect.poll(() => color3d(page, SEEDED), { timeout: 10_000 }).toBe(MARK_HOTSPOT);
});
