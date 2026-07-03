import { test, expect, type Page } from "@playwright/test";

// FR-61 — manual execution trace. With the Trace tool armed, clicking nodes
// builds an ordered route: a click on a reachable node splices in the shortest
// directed path between the trace's tail and the target (pure-core `extendTrace`),
// so intermediate hops are explicit. The trace panel lists the ordered steps and
// drives undo / clear / cinematic playback; the trail also carries to the 3D
// surface as a green tint. Driven through the live postMessage snapshot path so
// the graph is deterministic (a → b → c → d dependency chain).

const TRACE_GREEN = "#34d399"; // overlay-style.ts `trace` — the path-step colour

const SNAPSHOT = {
  version: 1,
  root: "trace-demo",
  nodeCount: 4,
  edgeCount: 3,
  nodes: [
    { address: "m:src/a.ts", kind: "module", name: "a.ts", location: { file: "src/a.ts", line: 0, character: 0 } },
    { address: "m:src/b.ts", kind: "module", name: "b.ts", location: { file: "src/b.ts", line: 0, character: 0 } },
    { address: "m:src/c.ts", kind: "module", name: "c.ts", location: { file: "src/c.ts", line: 0, character: 0 } },
    { address: "m:src/d.ts", kind: "module", name: "d.ts", location: { file: "src/d.ts", line: 0, character: 0 } },
  ],
  edges: [
    { from: "m:src/a.ts", to: "m:src/b.ts", type: "depends-on" },
    { from: "m:src/b.ts", to: "m:src/c.ts", type: "depends-on" },
    { from: "m:src/c.ts", to: "m:src/d.ts", type: "depends-on" },
  ],
};

async function bootLiveSnapshot(page: Page, snap: unknown = SNAPSHOT): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
      postMessage: () => {},
      getState: () => undefined,
      setState: () => undefined,
    });
  });
  await page.goto("/");
  await expect(page.getByText(/Loading dataset/i)).toBeVisible();
  await page.evaluate((s) => {
    window.postMessage({ type: "codegraph:snapshot", snapshot: s }, "*");
  }, snap);
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

/** Fire the real Sigma clickNode for an address (routes to trace when armed). */
async function clickNode(page: Page, address: string): Promise<void> {
  await page.evaluate((addr) => {
    const el = document.querySelector("div.absolute.inset-0") as HTMLElement & {
      __sigma: { emit(ev: string, payload: { node: string }): void };
    };
    el.__sigma.emit("clickNode", { node: addr });
  }, address);
}

/** The 3D node's overlay-resolved draw colour, via the dev __overlay3d hook. */
async function overlay3dColor(page: Page, address: string): Promise<string | null> {
  return page.evaluate((addr) => {
    const el = document.querySelector('[data-surface="3d"]') as
      | (HTMLElement & { __overlay3d?: (a: string) => string | null })
      | null;
    const c = el?.__overlay3d?.(addr) ?? null;
    return c ? c.toLowerCase() : null;
  }, address);
}

/** The painted RGB (0..1) of a directed 3D edge, via the dev __edge3d hook. */
async function edge3dColor(
  page: Page,
  from: string,
  to: string,
): Promise<{ r: number; g: number; b: number } | null> {
  return page.evaluate(
    ({ from, to }) => {
      const el = document.querySelector('[data-surface="3d"]') as
        | (HTMLElement & { __edge3d?: (f: string, t: string) => { r: number; g: number; b: number } | null })
        | null;
      return el?.__edge3d?.(from, to) ?? null;
    },
    { from, to },
  );
}

test("clicking nodes builds an ordered trace with spliced path hops, undo and clear", async ({
  page,
}) => {
  await bootLiveSnapshot(page);

  // Arm the trace tool — the panel appears, empty.
  await page.getByRole("button", { name: "Trace" }).click();
  const panel = page.getByTestId("trace-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("trace-count")).toHaveText("0");
  await expect(page.getByRole("button", { name: "Play the trace as a camera walk" })).toBeDisabled();

  // First click starts the trace at a.ts.
  await clickNode(page, "m:src/a.ts");
  await expect(page.getByTestId("trace-count")).toHaveText("1");

  // Clicking c.ts (two hops away) splices in the shortest path a → b → c, so the
  // intermediate b.ts becomes an explicit step — three ordered nodes in total.
  await clickNode(page, "m:src/c.ts");
  await expect(page.getByTestId("trace-count")).toHaveText("3");
  const steps = page.getByTestId("trace-step");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText("a.ts");
  await expect(steps.nth(1)).toContainText("b.ts");
  await expect(steps.nth(2)).toContainText("c.ts");

  // The status line narrates the last hop, and playback is now available.
  await expect(page.getByText(/2 hops/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Play the trace as a camera walk" })).toBeEnabled();

  await page.screenshot({
    path: "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad/trace-panel.png",
  });

  // Undo drops one hop; Clear empties the whole trace back to the prompt.
  await page.getByRole("button", { name: "Undo last hop" }).click();
  await expect(page.getByTestId("trace-count")).toHaveText("2");
  await page.getByRole("button", { name: "Clear trace" }).click();
  await expect(page.getByTestId("trace-count")).toHaveText("0");
  await expect(page.getByTestId("trace-steps")).toHaveCount(0);
});

// T8.8 — while tracing, each step shows its function signature + input/output, so a
// route reads as a sequence of function shapes (owner Image #13). The structural
// signature (params → returns) is cloud-safe and always shows; concrete `examples`
// are host-local (extension only) and enrich it when present.
const FN_SNAPSHOT = {
  version: 1,
  root: "trace-io",
  nodeCount: 3,
  edgeCount: 2,
  nodes: [
    {
      address: "ts:c.ts#parse",
      kind: "function",
      name: "parse",
      location: { file: "src/c.ts", line: 1, character: 0 },
      signature: "parse(input: string): Token[]",
      examples: ['parse("a=1") → [Token(a), Token(1)]'],
    },
    {
      address: "ts:c.ts#build",
      kind: "function",
      name: "build",
      location: { file: "src/c.ts", line: 5, character: 0 },
      signature: "build(tokens: Token[]): Ast",
    },
    {
      address: "ts:c.ts#emit",
      kind: "function",
      name: "emit",
      location: { file: "src/c.ts", line: 9, character: 0 },
      signature: "emit(ast: Ast): string",
    },
  ],
  edges: [
    { from: "ts:c.ts#parse", to: "ts:c.ts#build", type: "calls" },
    { from: "ts:c.ts#build", to: "ts:c.ts#emit", type: "calls" },
  ],
};

test("T8.8: each trace step shows its function signature + I/O while tracing", async ({ page }) => {
  await bootLiveSnapshot(page, FN_SNAPSHOT);

  await page.getByRole("button", { name: "Trace" }).click();
  // Click parse, then emit — the shortest path splices build, giving three steps.
  await clickNode(page, "ts:c.ts#parse");
  await clickNode(page, "ts:c.ts#emit");
  await expect(page.getByTestId("trace-count")).toHaveText("3");

  // Every step carries its signature line (structural params → returns, cloud-safe).
  const io = page.getByTestId("trace-step-io");
  await expect(io).toHaveCount(3);
  await expect(io.nth(0)).toContainText("input: string");
  await expect(io.nth(0)).toContainText("→ Token[]");
  await expect(io.nth(1)).toContainText("tokens: Token[]");
  await expect(io.nth(2)).toContainText("→ string");

  // The host-local sample I/O shows on the step that has it (extension-plane data).
  await expect(page.getByTestId("trace-step-example")).toHaveCount(1);
  await expect(page.getByTestId("trace-step-example")).toContainText('parse("a=1")');

  await page.screenshot({
    path: "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad/trace-io.png",
  });
});

test("a trace built on 2D carries to the 3D surface as a green trail", async ({ page }) => {
  await bootLiveSnapshot(page);

  // Build a → b → c on the 2D surface.
  await page.getByRole("button", { name: "Trace" }).click();
  await clickNode(page, "m:src/a.ts");
  await clickNode(page, "m:src/c.ts");
  await expect(page.getByTestId("trace-count")).toHaveText("3");

  // Switch to 3D — the trace persists (the model is owned by the Explorer) and the
  // spliced intermediate b.ts is tinted trace-green by the 3D draw loop.
  await page.getByRole("button", { name: "3d", exact: true }).click();
  await expect(page.locator('[data-surface="3d"] canvas')).toBeVisible();
  await expect(page.getByTestId("trace-count")).toHaveText("3");
  await expect.poll(() => overlay3dColor(page, "m:src/b.ts"), { timeout: 15_000 }).toBe(TRACE_GREEN);

  // FR-65a — the connecting EDGES along the route are tinted green too (not just
  // the nodes), matching the 2D path lens. The traced edge a → b reads as a lit
  // green (green channel dominant + bright); the untraced edge c → d stays dim.
  await expect
    .poll(async () => (await edge3dColor(page, "m:src/a.ts", "m:src/b.ts"))?.g ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(0.3);
  const traced = await edge3dColor(page, "m:src/a.ts", "m:src/b.ts");
  expect(traced).not.toBeNull();
  expect(traced!.g).toBeGreaterThan(traced!.r);
  expect(traced!.g).toBeGreaterThan(traced!.b);

  const untraced = await edge3dColor(page, "m:src/c.ts", "m:src/d.ts");
  expect(untraced).not.toBeNull();
  expect(untraced!.g).toBeLessThan(0.15); // off-route edge stays dim, not green

  await page.screenshot({
    path: "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad/fr65a-trace-3d-edges.png",
  });
});
