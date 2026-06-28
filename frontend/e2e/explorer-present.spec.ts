import { test, expect, type Page } from "@playwright/test";

// FR-39 (Epic 19): the presentation command bus. The host posts ephemeral
// `codegraph:command` messages (the connected agent driving the board); the
// webview bridge validates them through the shared core codec and the explorer
// dispatches each onto the FR-43 surface controller / view state. These tests
// drive a SIMULATED inbound command via window.postMessage — exactly the shape
// the host sends — and assert the surface reacts, the user-sovereignty preempt
// banner appears, and a manual "Take control" returns the wheel. (The live
// host→webview leg is Extension-Dev-Host-only; this proves the webview half.)

const SEEDED = "ts:src/adapters/cache/repo-cache.ts#repoCacheFile"; // carries a hotspot mark
const HIGHLIGHT_ACCENT = "#a78bfa";
const HIGHLIGHT_TRACE = "#34d399"; // the guided-tour / path step colour (FR-40)
const MARK_HOTSPOT = "#fb923c";

/** Pull N real, distinct node addresses from the live graph for a valid tour. */
async function tourStops(page: Page, n = 3): Promise<string[]> {
  return page.evaluate((count) => {
    const el = document.querySelector("div.absolute.inset-0") as
      | (HTMLElement & { __sigma?: { getGraph(): { nodes(): string[] } } })
      | null;
    return el?.__sigma ? el.__sigma.getGraph().nodes().slice(0, count) : [];
  }, n);
}

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

/** Switch to the 3D surface and wait for its controller + scene to settle. */
async function switchTo3D(page: Page): Promise<void> {
  await page.getByRole("button", { name: "3d", exact: true }).click();
  await expect(page.locator('[data-surface="3d"] canvas')).toBeVisible();
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
}

/** Post a command in the exact envelope the host sends. */
async function sendCommand(page: Page, command: unknown): Promise<void> {
  await page.evaluate((command) => {
    window.postMessage({ type: "codegraph:command", command }, "*");
  }, command);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Dataset").selectOption("codegraph");
  await waitForNode(page, SEEDED);
});

test("a highlight command drives the surface and raises the preempt banner (FR-39)", async ({ page }) => {
  const banner = page.getByRole("status");
  await expect(banner).toHaveCount(0); // the human holds the wheel at rest

  await sendCommand(page, { kind: "highlight_nodes", addresses: [SEEDED] });

  // The agent's highlight tints the node (overriding its hotspot mark)...
  await expect.poll(() => color2d(page, SEEDED), { timeout: 10_000 }).toBe(HIGHLIGHT_ACCENT);
  // ...and the preempt banner announces the hand-off.
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("The agent is presenting");

  // A manual "Take control" returns the wheel: banner gone, highlight cleared
  // back to the underlying mark.
  await banner.getByRole("button", { name: "Take control" }).click();
  await expect(banner).toHaveCount(0);
  await expect.poll(() => color2d(page, SEEDED), { timeout: 10_000 }).toBe(MARK_HOTSPOT);
});

test("an open_panel command opens the diagrams drawer (FR-39 view directive)", async ({ page }) => {
  await expect(page.getByRole("dialog", { name: "Knowledge diagrams" })).toHaveCount(0);

  await sendCommand(page, { kind: "open_panel", panel: "diagrams" });

  await expect(page.getByRole("dialog", { name: "Knowledge diagrams" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("opening the diagrams panel");
});

test("a replay command walks a guided tour step by step, banner up throughout (FR-40)", async ({ page }) => {
  const stops = await tourStops(page, 3);
  expect(stops).toHaveLength(3);
  const [first, , last] = stops;

  const banner = page.getByRole("status");
  await expect(banner).toHaveCount(0); // the human holds the wheel at rest

  // dwell 500 → stops light at 0 / 500 / 1000ms: a wide margin for the "not yet"
  // discriminator below while keeping the test quick.
  await sendCommand(page, { kind: "replay", addresses: stops, dwellMs: 500 });

  // Step 0 runs synchronously: the first stop lights (trace green) at once while
  // the last stop is NOT lit yet — proving the tour STEPS, not lights-all-at-once.
  await expect.poll(() => color2d(page, first), { timeout: 5_000 }).toBe(HIGHLIGHT_TRACE);
  expect(await color2d(page, last)).not.toBe(HIGHLIGHT_TRACE);

  // The preempt banner stays up for the whole tour so the human can reclaim it.
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("The agent is presenting");

  // The tour advances: the trail grows until the last stop lights too (cumulative).
  await expect.poll(() => color2d(page, last), { timeout: 5_000 }).toBe(HIGHLIGHT_TRACE);
  expect(await color2d(page, first)).toBe(HIGHLIGHT_TRACE); // earlier stops stay lit

  // A manual "Take control" returns the wheel: banner gone, trail cleared.
  await banner.getByRole("button", { name: "Take control" }).click();
  await expect(banner).toHaveCount(0);
});

test("a manual interrupt preempts an in-flight tour — pending steps never fire (FR-40)", async ({ page }) => {
  const stops = await tourStops(page, 3);
  expect(stops).toHaveLength(3);
  const [first, second, last] = stops;

  // dwell 800 → stops at 0 / 800 / 1600ms. Take control lands well before 800ms.
  await sendCommand(page, { kind: "replay", addresses: stops, dwellMs: 800 });
  await expect.poll(() => color2d(page, first), { timeout: 5_000 }).toBe(HIGHLIGHT_TRACE);

  const banner = page.getByRole("status");
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Take control" }).click();
  await expect(banner).toHaveCount(0);

  // Wait past the 800ms step-2 mark: the cancelled steps must never have lit, and
  // the trail from step 0 was wiped when control returned.
  await page.waitForTimeout(1_100);
  expect(await color2d(page, second)).not.toBe(HIGHLIGHT_TRACE);
  expect(await color2d(page, last)).not.toBe(HIGHLIGHT_TRACE);
  expect(await color2d(page, first)).not.toBe(HIGHLIGHT_TRACE);
});

test("a replay honours prefers-reduced-motion — instant final state, no stepping (FR-40)", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const stops = await tourStops(page, 3);
  expect(stops).toHaveLength(3);
  const [first, , last] = stops;

  // A huge dwell: were it stepping, the last stop wouldn't light for 10s. Under
  // reduced motion the plan collapses to one instant step lighting the whole trail.
  await sendCommand(page, { kind: "replay", addresses: stops, dwellMs: 5_000 });

  await expect.poll(() => color2d(page, first), { timeout: 2_000 }).toBe(HIGHLIGHT_TRACE);
  await expect.poll(() => color2d(page, last), { timeout: 2_000 }).toBe(HIGHLIGHT_TRACE);
  await expect(page.getByRole("status")).toContainText("replaying a 3-stop tour");
});

test("a replay command walks the same guided tour on the 3D surface, banner up (FR-40 parity)", async ({ page }) => {
  // Capture real stops from the (still-2D) graph before switching surfaces — the
  // 3D scene projects the same nodes, so these addresses are valid there too.
  const stops = await tourStops(page, 3);
  expect(stops).toHaveLength(3);
  const [first, , last] = stops;

  await switchTo3D(page);

  const banner = page.getByRole("status");
  await expect(banner).toHaveCount(0);

  // Drive through the REAL command path (postMessage → dispatch → mounted 3D
  // controller) so this proves the banner AND the 3D stepping together.
  await sendCommand(page, { kind: "replay", addresses: stops, dwellMs: 500 });

  // Step 0 lights the first stop (trace) at once while the last is NOT yet lit.
  await expect.poll(() => color3d(page, first), { timeout: 5_000 }).toBe(HIGHLIGHT_TRACE);
  expect(await color3d(page, last)).not.toBe(HIGHLIGHT_TRACE);

  await expect(banner).toBeVisible();
  await expect(banner).toContainText("The agent is presenting");

  // The tour advances on 3D too: the last stop eventually lights (cumulative trail).
  await expect.poll(() => color3d(page, last), { timeout: 5_000 }).toBe(HIGHLIGHT_TRACE);

  // Take control returns the wheel and cancels any pending 3D steps.
  await banner.getByRole("button", { name: "Take control" }).click();
  await expect(banner).toHaveCount(0);
});

test("a malformed command is ignored — no drive, no banner (untrusted guard)", async ({ page }) => {
  // Unknown kind + a bad style both fail the shared codec, so nothing happens.
  await sendCommand(page, { kind: "obliterate", addresses: [SEEDED] });
  await sendCommand(page, { kind: "highlight_nodes", addresses: [SEEDED], style: "neon" });

  // Give any (incorrect) handler a chance to run, then assert the surface is at
  // rest: the node keeps its mark tint and no banner appeared.
  await page.waitForTimeout(300);
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(await color2d(page, SEEDED)).toBe(MARK_HOTSPOT);
});
