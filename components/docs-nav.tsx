"use client";

import { DOCS } from "@/lib/docs";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

function DocsLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Docs" className="flex flex-col gap-4">
      {DOCS.map(({ title, pages }) => (
        <div key={title} className="flex flex-col gap-1">
          <p className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
          <ul className="flex flex-col">
            {pages.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={pathname === href ? "page" : undefined}
                  className={cn(
                    "block rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-secondary hover:text-foreground active:bg-secondary/60",
                    pathname === href ? "bg-secondary text-foreground shadow-[inset_2px_0_0_hsl(var(--crystal))]" : "text-muted-foreground",
                  )}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** The docs sidebar: a column from `sm`, a drawer above the page on a phone. */
export function DocsNav({ pathname }: { pathname: string | null }) {
  const drawer = useRef<HTMLDetailsElement>(null);
  // The layout stays mounted across docs pages, so close the drawer after following a link.
  useEffect(() => {
    if (drawer.current) drawer.current.open = false;
  }, [pathname]);
  const current = DOCS.flatMap((s) => s.pages).find((p) => p.href === pathname)?.label;
  return (
    <>
      <details ref={drawer} className="group rounded-xl border sm:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <span>Docs{current && <span className="text-muted-foreground"> · {current}</span>}</span>
          <ChevronDown aria-hidden className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t p-2">
          <DocsLinks pathname={pathname} />
        </div>
      </details>
      <aside className="hidden w-44 shrink-0 sm:block">
        <div className="sticky top-6">
          <DocsLinks pathname={pathname} />
        </div>
      </aside>
    </>
  );
}

export function CurrentDocsNav() {
  return <DocsNav pathname={usePathname()} />;
}
