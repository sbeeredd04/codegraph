import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDoc, listDocs } from "@/lib/docs-content";

// One guide page at the export root (`/getting-started`, `/how-it-works`,
// `/how-to-use`). The `[slug]` segment sits in the `(docs)` route group, so the
// URL has no `/docs/` prefix and the page emits a root-level HTML file whose
// relative `./_next/…` assets resolve under any mount (web sub-path + webview).
// The static `/docs` index and the static `/welcome` route take precedence over
// this dynamic segment; generateStaticParams emits only the known guide slugs.
//
// The body Markdown is rendered to HTML at build time by getDoc (server-only), so
// the page ships as static HTML with no client-side Markdown runtime — clean under
// the webview's strict no-eval CSP. The content is first-party and trusted, so the
// build-time HTML is injected directly (agent docs are sanitized at runtime
// elsewhere — see components/docs-drawer.tsx).

export function generateStaticParams(): { slug: string }[] {
  return listDocs().map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = await getDoc(slug);
  if (!doc) return { title: "Docs — codegraph" };
  return { title: `${doc.title} — codegraph`, description: doc.summary };
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.JSX.Element> {
  const { slug } = await params;
  const doc = await getDoc(slug);
  if (!doc) notFound();

  return (
    <article>
      <div className="docs-prose" dangerouslySetInnerHTML={{ __html: doc.html }} />

      <nav aria-label="Docs" className="mt-12 border-t border-zinc-900 pt-6">
        <Link
          href="/docs"
          prefetch={false}
          className="inline-flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-zinc-100"
        >
          <span aria-hidden>←</span> All guides
        </Link>
      </nav>
    </article>
  );
}
