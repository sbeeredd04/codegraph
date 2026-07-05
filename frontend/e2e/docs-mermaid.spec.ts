import { test, expect } from "@playwright/test";

// T13.1 — Mermaid rendering inside first-party Markdown docs on the website. The
// how-it-works guide embeds a ```mermaid flowchart; the build-time renderer emits a
// `.cg-mermaid` placeholder (carrying the source) and the client DocsMermaid
// enhancer upgrades it to a strict, CSP-safe SVG after hydration. This proves the
// diagram actually paints (an <svg> appears), stays passive (no injected scripts),
// and that the fallback source is replaced. Runs on the dev server.

test("a first-party guide renders an embedded Mermaid diagram as an SVG", async ({ page }) => {
  await page.goto("/how-it-works");
  await expect(page.getByRole("heading", { level: 1, name: /how it works/i })).toBeVisible();

  const diagram = page.locator(".cg-mermaid").first();
  await expect(diagram).toBeVisible();
  // The enhancer swaps the placeholder source for a rendered SVG.
  await expect(diagram.locator("svg")).toBeVisible({ timeout: 15_000 });

  const facts = await diagram.evaluate((el) => ({
    svgCount: el.querySelectorAll("svg").length,
    scripts: el.querySelectorAll("script").length,
    done: el.hasAttribute("data-cg-mermaid-done"),
    srcGone: el.querySelector(".cg-mermaid-src") === null,
  }));
  expect(facts.svgCount).toBeGreaterThan(0);
  expect(facts.scripts).toBe(0); // strict render — no injected scripts
  expect(facts.done).toBe(true);
  expect(facts.srcGone).toBe(true);
});
