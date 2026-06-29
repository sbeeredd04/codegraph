"use client";

// Docs sidebar navigation. A small client component so it can highlight the active
// guide via usePathname; everything else in the docs section is static server-
// rendered HTML. No eval / dynamic import — hydrates cleanly under the webview CSP.

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { DocMeta } from "@/lib/docs-content";

export function DocsNav({ docs }: { docs: readonly DocMeta[] }): React.JSX.Element {
  const pathname = usePathname();
  return (
    <nav aria-label="Docs" className="flex flex-col gap-1">
      <Link
        href="/docs"
        prefetch={false}
        aria-current={pathname === "/docs" ? "page" : undefined}
        className={navItem(pathname === "/docs")}
      >
        Overview
      </Link>
      {docs.map((d) => {
        const href = `/${d.slug}`;
        const active = pathname === href;
        return (
          <Link
            key={d.slug}
            href={href}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={navItem(active)}
          >
            {d.title}
          </Link>
        );
      })}
    </nav>
  );
}

function navItem(active: boolean): string {
  return [
    "rounded-lg px-3 py-2 text-sm transition-colors focus:outline-none focus-visible:ring-2",
    "focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a]",
    active
      ? "bg-violet-500/15 font-medium text-violet-200"
      : "text-zinc-400 hover:bg-zinc-900/70 hover:text-zinc-100",
  ].join(" ");
}
