import { test, expect, type Page } from "@playwright/test";

// FR-55 — local repo ingestion with a live-progress UI. The dual trigger (the
// board's "Index" button OR the agent) converges on ONE host scan that streams
// coarse progress ticks (discover → parse → resolve → done) the panel binds to.
//
// The web plane has no host to scan (subscribeToIngest only fires inside the VS
// Code webview — AD-14), so we drive the panel through the dev-only `__ingest`
// hook: push synthetic ticks and assert the rendered stepper / bar / counts. This
// is the same harness pattern the __diff / __sigma hooks use. The panel reflects a
// scan, never source (FR-9): a tick carries counts + a repo-relative file only.

type IngestEvent = {
  phase: string;
  found?: number;
  parsed?: number;
  failed?: number;
  nodes?: number;
  edges?: number;
  file?: string;
  message?: string;
};

async function waitForExplorer(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const el = document.querySelector("[data-explorer]") as
            | (HTMLElement & { __ingest?: unknown })
            | null;
          return Boolean(el?.__ingest);
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function pushIngest(page: Page, event: IngestEvent): Promise<void> {
  await page.evaluate((ev) => {
    const el = document.querySelector("[data-explorer]") as
      | (HTMLElement & { __ingest?: { push(e: IngestEvent): void } })
      | null;
    el!.__ingest!.push(ev);
  }, event);
}

type IngestEventArg = Parameters<typeof pushIngest>[1];

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForExplorer(page);
});

test("streams a scan through its phases: bar climbs, counts + steps update, done is 100%", async ({
  page,
}) => {
  const panel = page.getByTestId("ingest-panel");
  // Idle: no panel until a scan starts.
  await expect(panel).toHaveCount(0);

  await pushIngest(page, { phase: "discovering" });
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("ingest-detail")).toContainText(/scanning the workspace/i);

  await pushIngest(page, { phase: "discovering", found: 100 });
  await expect(page.getByTestId("ingest-detail")).toContainText("100 files found");

  // Half-parsed → 10 + 80*0.5 = 50%, with a live counts line + current file.
  await pushIngest(page, {
    phase: "parsing",
    found: 100,
    parsed: 50,
    nodes: 30,
    edges: 12,
    file: "src/extension/index.ts",
  });
  await expect(page.getByTestId("ingest-percent")).toHaveText("50%");
  await expect(page.getByTestId("ingest-detail")).toContainText("50/100 files");
  await expect(page.getByTestId("ingest-detail")).toContainText("30 nodes");

  // Done → 100%, the last step checked, the final tally in the detail line.
  await pushIngest(page, { phase: "done", found: 100, parsed: 100, nodes: 60, edges: 40 });
  await expect(page.getByTestId("ingest-percent")).toHaveText("100%");
  await expect(page.getByTestId("ingest-detail")).toContainText("60 nodes");
  await expect(page.getByTestId("ingest-detail")).toContainText("40 edges");
  // A settled run offers a re-index.
  await expect(page.getByTestId("ingest-reindex")).toBeVisible();
});

test("the toolbar Rescan button triggers a scan and shows the live panel", async ({ page }) => {
  // The user trigger (FR-55a). On the web plane requestIndex() is a no-op (no host),
  // but the optimistic `discovering` tick shows the panel the instant it's clicked.
  await expect(page.getByTestId("ingest-panel")).toHaveCount(0);
  await page.getByRole("button", { name: "Rescan repository" }).click();
  await expect(page.getByTestId("ingest-panel")).toBeVisible();
  await expect(page.getByTestId("ingest-steps")).toBeVisible();
});

test("a failed scan surfaces the reason and keeps the reached progress", async ({ page }) => {
  await pushIngest(page, { phase: "parsing", found: 10, parsed: 4 });
  await pushIngest(page, { phase: "error", message: "Pyright crashed" });

  const err = page.getByTestId("ingest-error");
  await expect(err).toBeVisible();
  await expect(err).toHaveText("Pyright crashed");
  // The bar holds where it failed (10 + 80*0.4 = 42%), not snapped to 0/100.
  await expect(page.getByTestId("ingest-percent")).toHaveText("42%");
});

test("a settled panel can be dismissed, and a fresh run re-shows it clean", async ({ page }) => {
  await pushIngest(page, { phase: "done", found: 5, parsed: 5, nodes: 9, edges: 3 });
  const panel = page.getByTestId("ingest-panel");
  await expect(panel).toBeVisible();

  await page.getByRole("button", { name: "Hide indexing panel" }).click();
  await expect(panel).toHaveCount(0);

  // A new run from a terminal state resets counts (no stale 5/5 carried).
  await pushIngest(page, { phase: "discovering", found: 200 } as IngestEventArg);
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("ingest-detail")).toContainText("200 files found");
});
