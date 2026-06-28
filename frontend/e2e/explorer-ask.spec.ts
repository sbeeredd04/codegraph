import { test, expect, type Page } from "@playwright/test";

// FR-30 — AI-assist "Ask". codegraph holds no AI key; the panel builds a prompt
// (pure core buildAskPrompt) the user pastes into their own connected agent. We
// assert the generated prompt — shown live in the preview — embeds the typed
// question, references the real codegraph MCP query tools, and anchors on the
// selected node's context when one is selected.

const SHOT =
  "/private/tmp/claude-501/-Users-sriujjwal-github-codegraph/c61c1bf7-cdf8-4199-b01f-a9f9fd5c54c4/scratchpad";

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

test("FR-30: Ask builds a graph-grounded prompt from the question", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);

  await page.getByRole("button", { name: "Ask" }).click();
  const dialog = page.getByRole("dialog", { name: "Ask your agent" });
  await expect(dialog).toBeVisible();

  await dialog.getByRole("textbox").fill("How does a request reach the graph core?");

  const prompt = dialog.getByTestId("ask-prompt");
  await expect(prompt).toContainText("How does a request reach the graph core?");
  await expect(prompt).toContainText("find_nodes");
  await expect(prompt).toContainText("save_diagram");
  await expect(prompt).toContainText("save_doc");
  await page.screenshot({ path: `${SHOT}/ask-panel.png` });

  // Escape closes.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("FR-30: the prompt anchors on the selected node's context", async ({ page }) => {
  await page.goto("/");
  await waitForGraph(page);

  // Select the highest-degree node via the dev-only __sigma hook.
  const addr = await page.evaluate(() => {
    const el = document.querySelector("div.absolute.inset-0") as HTMLElement & {
      __sigma: {
        getGraph(): { forEachNode(cb: (id: string) => void): void; degree(id: string): number };
        emit(ev: string, payload: { node: string }): void;
      };
    };
    const g = el.__sigma.getGraph();
    let best = "";
    let bestDeg = -1;
    g.forEachNode((id) => {
      const d = g.degree(id);
      if (d > bestDeg) {
        bestDeg = d;
        best = id;
      }
    });
    el.__sigma.emit("clickNode", { node: best });
    return best;
  });

  await page.getByRole("button", { name: "Ask" }).click();
  const prompt = page.getByTestId("ask-prompt");
  await expect(prompt).toContainText("I'm currently looking at");
  await expect(prompt).toContainText(addr);
  await expect(prompt).toContainText("describe_node on the node above");
});
