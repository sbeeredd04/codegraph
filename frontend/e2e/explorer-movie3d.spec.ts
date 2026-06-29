import { test, expect, type Page } from "@playwright/test";

// FR-48: cinematic movie mode on the 3D surface. Drives the dev-only __movie hook
// (tree-shaken in prod) to assert the camera flies through an ordered node path in
// order, the transport (next/prev/pause) works, reduced motion snaps without
// auto-stepping, and a manual orbit cancels an in-flight movie. Position is read
// via the FR-47 __cameraState target — no WebGL pixel-sampling.

interface Cam {
  radius: number;
  theta: number;
  phi: number;
  tx: number;
  ty: number;
  tz: number;
}
interface MovieSnapshot {
  active: boolean;
  playing: boolean;
  reduced: boolean;
  index: number;
  total: number;
  label: string;
}
interface MovieHook {
  play: (a: readonly string[], opts?: { dwellMs?: number; flyMs?: number; autoplay?: boolean }) => void;
  next: () => void;
  prev: () => void;
  stop: () => void;
  state: () => MovieSnapshot;
  ids: () => string[];
  pos: (a: string) => { x: number; y: number; z: number } | null;
}

// `Surface` is a TYPE (erased at compile) so casting to it inside page.evaluate is
// fine; the runtime body is just a DOM query. The query is inlined in every
// evaluate because a Node-side helper can't be referenced in the browser context.
type Surface = HTMLElement & { __movie?: MovieHook; __cameraState?: () => Cam };
const SEL = '[data-surface="3d"]';

async function switchTo3D(page: Page): Promise<void> {
  await page.getByRole("button", { name: "3d", exact: true }).click();
  await expect(page.locator('[data-surface="3d"] canvas')).toBeVisible();
  await expect
    .poll(
      () => page.evaluate((s) => Boolean((document.querySelector(s) as Surface)?.__movie), SEL),
      { timeout: 15_000 },
    )
    .toBe(true);
}

const movieState = (page: Page): Promise<MovieSnapshot> =>
  page.evaluate((s) => (document.querySelector(s) as Surface).__movie!.state(), SEL);
const firstIds = (page: Page, n: number): Promise<string[]> =>
  page.evaluate(
    ({ s, k }) => (document.querySelector(s) as Surface).__movie!.ids().slice(0, k),
    { s: SEL, k: n },
  );
const nodePos = (page: Page, address: string): Promise<{ x: number; y: number; z: number }> =>
  page.evaluate(
    ({ s, a }) => (document.querySelector(s) as Surface).__movie!.pos(a)!,
    { s: SEL, a: address },
  );

// Distance from the camera target (where a stop frames to) to a node's position.
async function targetGap(page: Page, p: { x: number; y: number; z: number }): Promise<number> {
  const c = await page.evaluate((s) => (document.querySelector(s) as Surface).__cameraState!(), SEL);
  return Math.hypot(c.tx - p.x, c.ty - p.y, c.tz - p.z);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await switchTo3D(page);
});

test("movie transport steps through the path in order (FR-48)", async ({ page }) => {
  const path = await firstIds(page, 3);
  const p = await Promise.all(path.map((a) => nodePos(page, a)));

  // Load without autoplay so stepping is fully deterministic.
  await page.evaluate(
    ({ s, ids }) => (document.querySelector(s) as Surface).__movie!.play(ids, { autoplay: false, flyMs: 50 }),
    { s: SEL, ids: path },
  );
  await expect.poll(() => movieState(page).then((s) => s.index)).toBe(0);
  await expect.poll(() => targetGap(page, p[0])).toBeLessThan(0.5);

  await page.evaluate((s) => (document.querySelector(s) as Surface).__movie!.next(), SEL);
  await expect.poll(() => movieState(page).then((s) => s.index)).toBe(1);
  await expect.poll(() => targetGap(page, p[1])).toBeLessThan(0.5);

  await page.evaluate((s) => (document.querySelector(s) as Surface).__movie!.next(), SEL);
  await expect.poll(() => movieState(page).then((s) => s.index)).toBe(2);
  await expect.poll(() => targetGap(page, p[2])).toBeLessThan(0.5);

  await page.evaluate((s) => (document.querySelector(s) as Surface).__movie!.prev(), SEL);
  await expect.poll(() => movieState(page).then((s) => s.index)).toBe(1);
  await expect.poll(() => targetGap(page, p[1])).toBeLessThan(0.5);
});

test("movie mode auto-advances to the end on its own (FR-48)", async ({ page }) => {
  const path = await firstIds(page, 3);
  const last = await nodePos(page, path[2]);

  await page.evaluate(
    ({ s, ids }) => (document.querySelector(s) as Surface).__movie!.play(ids, { dwellMs: 120, flyMs: 50 }),
    { s: SEL, ids: path },
  );
  // It walks forward unaided and rests on the final stop.
  await expect
    .poll(() => movieState(page).then((s) => `${s.index}:${s.playing}`), { timeout: 8_000 })
    .toBe("2:false");
  await expect.poll(() => targetGap(page, last)).toBeLessThan(0.5);
});

test("movie mode honours reduced motion — snaps, no auto-stepping (FR-48)", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const path = await firstIds(page, 3);
  const p = await Promise.all(path.map((a) => nodePos(page, a)));

  await page.evaluate(
    ({ s, ids }) => (document.querySelector(s) as Surface).__movie!.play(ids),
    { s: SEL, ids: path },
  );
  const s = await movieState(page);
  expect(s.reduced).toBe(true);
  expect(s.playing).toBe(false); // never auto-steps under reduced motion
  expect(s.index).toBe(0);
  // The camera snapped straight to the first stop (no animation to wait on).
  expect(await targetGap(page, p[0])).toBeLessThan(0.5);

  // Manual stepping still works and snaps.
  await page.evaluate((sel) => (document.querySelector(sel) as Surface).__movie!.next(), SEL);
  await expect.poll(() => movieState(page).then((m) => m.index)).toBe(1);
  expect(await targetGap(page, p[1])).toBeLessThan(0.5);
});

test("a manual orbit cancels an in-flight movie (FR-48)", async ({ page }) => {
  const path = await firstIds(page, 3);
  await page.evaluate(
    ({ s, ids }) => (document.querySelector(s) as Surface).__movie!.play(ids, { dwellMs: 8_000, flyMs: 50 }),
    { s: SEL, ids: path },
  );
  await expect.poll(() => movieState(page).then((s) => s.active)).toBe(true);

  // Grab the canvas and drag — orbiting must end the movie (the human takes over).
  const box = await page.locator('[data-surface="3d"] canvas').boundingBox();
  if (!box) throw new Error("no 3d canvas");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 30, { steps: 8 });
  await page.mouse.up();

  await expect.poll(() => movieState(page).then((s) => s.active)).toBe(false);
});
