import { test, expect, type Page } from "@playwright/test";

// FR-53 (T8.5) — the first-run coach-mark: a one-time human orientation shown on the
// first board visit and never again (a localStorage flag). Distinct from the FR-42
// agent OnboardingPanel. We assert it appears fresh, dismisses, persists dismissed
// across reload, and never blocks the toolbar (its body is pointer-events-none).
// Runs on the dev server for the `__sigma` ready hook, like the onboarding spec.

async function waitForGraph(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const el = document.querySelector("div.absolute.inset-0") as
            | (HTMLElement & { __sigma?: { getGraph(): { order: number } } })
            | null;
          return el?.__sigma ? el.__sigma.getGraph().order : 0;
        }),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
}

test("FR-53: the first-run hint shows once, then stays dismissed across reloads", async ({ page }) => {
  // A fresh context has no seen-flag, so the hint greets the new user.
  await page.goto("/");
  await waitForGraph(page);

  const hint = page.getByTestId("first-run-hint");
  await expect(hint).toBeVisible();
  await expect(hint).toContainText(/New here/i);
  await expect(hint.getByText(/Ask your agent/i)).toBeVisible();

  // It never blocks the toolbar: the Setup affordance is still clickable underneath.
  await expect(page.getByRole("button", { name: /Setup/ })).toBeVisible();

  // Dismiss via "Got it" hides it.
  await hint.getByRole("button", { name: "Got it" }).click();
  await expect(hint).toHaveCount(0);

  // The dismissal persists per-browser: a reload does NOT bring it back.
  await page.reload();
  await waitForGraph(page);
  await expect(page.getByTestId("first-run-hint")).toHaveCount(0);
});

test("FR-53: Escape dismisses the first-run hint", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);

  const hint = page.getByTestId("first-run-hint");
  await expect(hint).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(hint).toHaveCount(0);
});
