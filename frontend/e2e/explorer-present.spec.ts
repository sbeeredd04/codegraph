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
const MARK_HOTSPOT = "#fb923c";

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
