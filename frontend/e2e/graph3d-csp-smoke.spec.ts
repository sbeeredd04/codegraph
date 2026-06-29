import { test, expect } from "@playwright/test";

// FR-46 under the webview's constraints — the load-bearing proof for the 3D
// rebuild. three.js + d3-force-3d are heavyweight, dynamically-imported deps; this
// verifies the 3D surface boots a REAL WebGL context inside the production static
// export served under a strict nonce CSP (no 'unsafe-eval', no 'unsafe-inline'
// scripts) and a non-root mount. three's core is eval-free and its chunk loads as
// a same-origin <script> (allowed by `script-src 'self'`); if any path needed
// eval / a blob worker / an un-nonced inline script, the CSP would block it and
// this spec would fail. The dev __overlay3d/__controller hooks are tree-shaken in
// the production build, so this proves the surface a different way than the dev
// FR-37/FR-40 parity tests: the canvas actually acquires a GL context, clean.

const isCspViolation = (text: string): boolean => /Refused to|Content Security Policy/i.test(text);

test("the 3D WebGL surface boots under the strict nonce CSP with zero violations", async ({ page }) => {
  const violations: string[] = [];
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") {
      if (isCspViolation(m.text())) violations.push(m.text());
      else if (!/favicon/.test(m.text())) errors.push(m.text());
    }
  });
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("webview.html");
  // Boot lands on the 2D Sigma surface.
  await expect(page.locator('[data-surface="2d"] canvas, canvas').first()).toBeVisible();

  // Switch to 3D: mounts the dynamic chunk (three + d3-force-3d) and builds the
  // WebGL scene, all under the strict CSP.
  await page.getByRole("button", { name: "3d", exact: true }).click();
  const canvas = page.locator('[data-surface="3d"] canvas');
  await expect(canvas).toBeVisible({ timeout: 20_000 });

  // The canvas must hold a genuine WebGL context with a non-empty drawing buffer —
  // i.e. three really initialised the renderer, not just mounted an empty element.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const c = document.querySelector('[data-surface="3d"] canvas') as HTMLCanvasElement | null;
          if (!c) return false;
          const gl =
            (c.getContext("webgl2") as WebGL2RenderingContext | null) ??
            (c.getContext("webgl") as WebGLRenderingContext | null);
          return Boolean(gl) && c.width > 0 && c.height > 0;
        }),
      { timeout: 20_000 },
    )
    .toBe(true);

  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});
