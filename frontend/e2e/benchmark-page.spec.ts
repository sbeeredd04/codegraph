import { test, expect } from "@playwright/test";

// T14.6 — the public benchmark page (/benchmark). This spec is both a render smoke
// AND an integrity guard: the benchmark result is deliberately NUANCED (codegraph
// wins on the whole-codebase structural question, ties on local lookups, and adds
// overhead on targeted navigation on the small requests repo). If anyone ever
// "rounds up" the page into a fabricated blanket win, these assertions fail —
// the honest ties/overhead and the real miscount numbers must stay on the page.

const isIgnorableError = (t: string): boolean => /favicon\.ico/.test(t);

test("the benchmark page leads with the honest grounded-accuracy thesis", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !isIgnorableError(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/benchmark");

  await expect(page.getByRole("heading", { level: 1 })).toContainText(/makes it certain/i);
  // The real measured miscount — the agent saw ~half the code without codegraph.
  await expect(page.getByTestId("miscount-modules")).toContainText("19");
  await expect(page.getByTestId("miscount-modules")).toContainText("37");
  await expect(page.getByTestId("miscount-methods")).toContainText("177");
  await expect(page.getByTestId("miscount-methods")).toContainText("475");

  expect(errors).toEqual([]);
});

test("every task row is shown, including the honest ties and overhead", async ({ page }) => {
  await page.goto("/benchmark");

  // All six tasks present — nothing hidden.
  for (const id of ["graph-stats", "callers", "auth-subclasses", "call-path", "dependencies", "api-surface"]) {
    await expect(page.getByTestId(`task-${id}`)).toBeVisible();
  }

  // The one decisive win.
  await expect(page.getByTestId("task-graph-stats")).toContainText(/codegraph wins/i);
  await expect(page.getByTestId("task-graph-stats")).toContainText(/wrong/i); // baseline was wrong here

  // The honest non-wins must remain: at least one tie and one overhead verdict.
  await expect(page.getByText("tie").first()).toBeVisible();
  await expect(page.getByText("overhead").first()).toBeVisible();

  // The transparency about the open find_path gap.
  await expect(page.getByRole("heading", { name: /still fixing/i })).toBeVisible();
});

test("the landing nav links to the benchmark page", async ({ page }) => {
  await page.goto("/welcome");
  await page.getByRole("navigation", { name: /primary/i }).getByRole("link", { name: /^benchmark$/i }).click();
  await expect(page).toHaveURL(/\/benchmark$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/makes it certain/i);
});
