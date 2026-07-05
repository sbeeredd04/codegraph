import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Marked } from "marked";

// Build-time docs loader (server-only). Reads the first-party guide Markdown under
// content/docs/, parses a tiny frontmatter block, and renders the body to HTML with
// marked. This runs during `next build` (static export) and `next dev` — NEVER in
// the browser — so the rendered pages ship as plain static HTML with no client-side
// Markdown runtime, which keeps them clean under the webview's strict no-eval CSP.
//
// The content is FIRST-PARTY and trusted (authored in this repo, not by an agent),
// so it is rendered directly — unlike the agent-authored docs drawer, which is
// untrusted and DOMPurify-sanitized at runtime (see components/docs-drawer.tsx).

const CONTENT_DIR = join(process.cwd(), "content", "docs");

// Escape for safe embedding of the raw diagram source inside the placeholder <pre>.
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// One configured Marked instance for the first-party guides (T13.1 — Mermaid in
// Markdown). GFM on; a single renderer override special-cases ```mermaid fences:
// instead of a code block they emit a `.cg-mermaid` placeholder carrying the
// (escaped) source, which the client DocsMermaid enhancer upgrades to a strict,
// CSP-safe SVG after hydration (JS off → it degrades to a readable code block).
// Every OTHER language returns false, so marked falls back to its DEFAULT code
// renderer — non-mermaid blocks stay byte-identical to before, no regression.
const docMarked = new Marked({ gfm: true, breaks: false });
docMarked.use({
  renderer: {
    code({ text, lang }) {
      if ((lang ?? "").trim().toLowerCase() === "mermaid") {
        return `<div class="cg-mermaid" data-cg-mermaid><pre class="cg-mermaid-src">${escapeHtml(text)}</pre></div>\n`;
      }
      return false;
    },
  },
});

export interface DocMeta {
  readonly slug: string;
  readonly title: string;
  readonly order: number;
  readonly summary: string;
}

export interface DocPage extends DocMeta {
  /** Body Markdown rendered to HTML at build time. */
  readonly html: string;
}

// Minimal `---`-delimited frontmatter parser (key: value lines, no nested YAML).
// Avoids a gray-matter dependency for the handful of scalar fields we use.
function parseFrontmatter(raw: string): { readonly data: Record<string, string>; readonly body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { data: {}, body: raw };
  const data: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { data, body: match[2] };
}

function slugsFromDisk(): string[] {
  return readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
}

function readMeta(slug: string): DocMeta {
  const raw = readFileSync(join(CONTENT_DIR, `${slug}.md`), "utf8");
  const { data } = parseFrontmatter(raw);
  return {
    slug,
    title: data.title ?? slug,
    order: Number(data.order ?? 999),
    summary: data.summary ?? "",
  };
}

/** All guide pages, ordered by their frontmatter `order` — for the index + nav. */
export function listDocs(): DocMeta[] {
  return slugsFromDisk()
    .map(readMeta)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

/** One guide page with its body rendered to HTML, or null if the slug is unknown. */
export async function getDoc(slug: string): Promise<DocPage | null> {
  if (!slugsFromDisk().includes(slug)) return null;
  const raw = readFileSync(join(CONTENT_DIR, `${slug}.md`), "utf8");
  const { data, body } = parseFrontmatter(raw);
  const html = await docMarked.parse(body);
  return {
    slug,
    title: data.title ?? slug,
    order: Number(data.order ?? 999),
    summary: data.summary ?? "",
    html,
  };
}
