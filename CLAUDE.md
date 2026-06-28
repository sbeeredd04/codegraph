# codegraph — project guide for Claude

codegraph is a VS Code extension + Next.js web app that graphs a codebase into a
navigable knowledge surface (graph, diagrams, docs, AI-assist, editor deep-links).
It runs in two planes: a **local plane** (source host-local, OSS) and a
**source-blind cloud plane** (Vercel). One Next codebase builds three targets:
static-export (VS Code webview) · local serve · Vercel.

## Architecture invariants (do not violate)

- **Hexagonal core purity (AD-1)**: `src/core/**` is pure — no `vscode`, `fs`,
  network, or LLM. Enforced by dependency-cruiser in CI. Adapters (`src/adapters/**`)
  may use `vscode`. New pure logic goes in `src/core/**`.
- **Frontend↔core boundary (AD-13)**: the frontend imports core via the `@core/*`
  alias, emitted to `frontend/vendor/core/core/*` by `tsconfig.frontend-core.json`
  (repo root). Its `include` is a GLOB for `src/core/**/*.ts` (new core files
  auto-emit) but an explicit ALLOWLIST for `src/adapters/surfaces/webview/*.ts`.
  A NEW webview-adapter file the frontend needs MUST be added to that allowlist;
  new `src/core/**` files do not. After adding core, run `npm --prefix frontend run build:core`.
- **Source stays host-local (AD-16)** and the **cloud plane is source-blind (AD-14)**:
  only graph identities/structure + relative path metadata may reach the cloud —
  never source bytes, never an absolute host path. Host-only context (e.g. the
  editor root for FR-32 deep-links) rides the live webview message, never the
  portable `GraphSnapshot`.
- **Read-only board (FR-9)**: never mutate user source.
- **No LLM key in-app (the moat)**: AI-assist builds a prompt for the user's OWN
  connected agent (Claude Code/Codex over the codegraph MCP) — codegraph never
  calls an LLM.
- **Strict webview CSP, no eval**: dynamic-import heavy deps; prove they render
  under the strict nonce CSP via a `*-smoke.spec.ts`.
- **Agent-authored content is UNTRUSTED**: escape (React children) / sanitize
  (DOMPurify strict allowlist) / render Mermaid `securityLevel:"strict"`. The only
  non-web URL scheme allowed in docs is `codegraph://node/`.

## Per-slice cadence (the loop)

ONE focused slice per iteration:
1. **Verify gate** — core: `npm run verify`. Frontend: `npm --prefix frontend run build:core`,
   then `npx tsc --noEmit` + `npx eslint` + `npx playwright test`; add
   `npm --prefix frontend run test:e2e:export` when the slice touches render/CSP/export.
   Add an e2e per behavioural slice.
2. **UI slices additionally** (see Design discipline) — Playwright UX + screenshot + Better Design.
3. **Atomic conventional commit**; footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
4. **Push to the `codegraph` remote** (NOT origin): `git push codegraph feat/epic1-foundation`.
   github.com/sbeeredd04/codegraph. Branch `feat/epic1-foundation`.
5. Update the `codegraph-comprehension-backlog` memory; re-arm the loop.

`media/` and `frontend/vendor/`, `frontend/out/` are gitignored (build artifacts).
`npm run verify` = tsc + dependency-cruiser + vitest + esbuild bundle (frontend/out → media/explorer).
Never `--no-verify`, never amend without asking, never force-push.

## Design & verification discipline (every UI/UX slice)

Required, without being asked (see FR-36 in `_bmad-output/planning-artifacts/sprint-change-proposal-2026-06-28-dashboard-ux.md`):
1. **Better Design** — `get-ui-principle` / `get-ux-principle` before building,
   `get-review-rules` self-review after. *Currently blocked* (anon quota 25/25
   exhausted) — owner must claim the free account; until then use the self-authored
   dark/premium system and review manually against the same WCAG/visual rules.
2. **Playwright for UX** — drive the real flow on the dev server (:3000) and assert behaviour.
3. **Screenshots for UI** — capture and visually analyze every UI slice.
4. **Keep the dev server live** so the owner can watch progress.

Design system: self-authored dark/premium. Type/brand (FR-33): Space Grotesk
(display), Inter (UI), JetBrains Mono (code) via `next/font`. Tailwind v4 `@theme inline`.

## Current direction (2026-06-28)

Theme T4 / Epic 18 — turn the explorer into a real **dashboard**: collapsible +
resizable docks, **draggable** floating panels, persisted layout (FR-34); a
**landing page** (FR-35); the design discipline above (FR-36). Plus the carried
comprehension backlog (FR-25..FR-33 mostly delivered; FR-31 in-extension
reveal-in-editor still queued). Track state in the `codegraph-comprehension-backlog`
memory and the BMAD sprint-change proposals under `_bmad-output/planning-artifacts/`.

Note: `frontend/AGENTS.md` warns the Next.js here may differ from training data —
read `node_modules/next/dist/docs/` before non-trivial frontend work.
