import { test, expect } from "@playwright/test";

// T14.6 → corrected T16 — the public benchmark page (/benchmark). This spec is both a
// render smoke AND an INTEGRITY GUARD for honesty. The page was corrected after a scale
// re-examination showed the original "agent miscounts your codebase 2x" claim was a scope
// artifact (a capable agent counts structure accurately on its own). These assertions keep
// the honest framing pinned: the page must (a) NOT claim a counting win — it must show the
// agent counted EXACTLY without codegraph, (b) keep the "what we haven't proven at scale"
// caveat, and (c) lead with the defensible relational result (the resolved dispatch path).
// If anyone re-inflates it into a false blanket win, these fail.

const isIgnorableError = (t: string): boolean => /favicon\.ico/.test(t);

test("the benchmark page leads with the honest relational thesis, not a counting win", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !isIgnorableError(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/benchmark");

  await expect(page.getByRole("heading", { level: 1 })).toContainText(/resolves it/i);
  // The demonstration: a resolved call path ending at the concrete override via virtual dispatch.
  await expect(page.getByTestId("hop-0")).toContainText("requests.get");
  const lastHop = page.getByTestId("hop-5");
  await expect(lastHop).toContainText("HTTPAdapter.send");
  await expect(lastHop).toContainText(/virtual dispatch/i);

  expect(errors).toEqual([]);
});

test("the counting correction stays on the page — the agent counted EXACTLY without codegraph", async ({ page }) => {
  await page.goto("/benchmark");

  // The honesty section names the retracted claim and the scope artifact.
  await expect(page.getByRole("heading", { name: /tested and dropped/i })).toBeVisible();
  await expect(page.getByText(/scope artifact/i)).toBeVisible();

  // Both count checks show the codegraph-free agent hitting the ground truth exactly.
  const rich = page.getByTestId("count-Textualize/rich");
  await expect(rich).toContainText("100 / 181 / 161 / 751");
  await expect(rich).toContainText("exact");
  const requests = page.getByTestId("count-psf/requests");
  await expect(requests).toContainText("19 / 52 / 91 / 177");
  await expect(requests).toContainText("exact");
});

test("the per-task table keeps the honest overhead + the unproven-at-scale caveat", async ({ page }) => {
  await page.goto("/benchmark");

  for (const id of ["call-path", "graph-stats", "callers", "auth-subclasses", "dependencies", "api-surface"]) {
    await expect(page.getByTestId(`task-${id}`)).toBeVisible();
  }
  // call-path is the relational highlight; the small-repo tasks stay honestly neutral/overhead.
  await expect(page.getByTestId("task-call-path")).toContainText(/resolved path/i);
  await expect(page.getByText("overhead").first()).toBeVisible();
  await expect(page.getByText(/agent does this alone/i).first()).toBeVisible();

  // The scale claim is explicitly NOT asserted as proven.
  await expect(page.getByRole("heading", { name: /haven.t proven yet/i })).toBeVisible();
  await expect(page.getByText(/not demonstrated here/i)).toBeVisible();
});

test("the landing nav links to the benchmark page", async ({ page }) => {
  await page.goto("/welcome");
  await page.getByRole("navigation", { name: /primary/i }).getByRole("link", { name: /^benchmark$/i }).click();
  await expect(page).toHaveURL(/\/benchmark$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/resolves it/i);
});
