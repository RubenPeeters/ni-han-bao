"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

const SERVER_PAGES = [
  { page: "leaderboard", label: "Leaderboard" },
  { page: "channels", label: "Channels" },
  { page: "emoji", label: "Emoji" },
  { page: "timeline", label: "Timeline" },
  { page: "stores", label: "Where we play" },
];

export function SiteNav() {
  const pathname = usePathname();
  // Stat pages exist per server, so their links only show inside one.
  const { guildId } = useParams<{ guildId?: string }>();
  const links = [
    { href: "/", label: "Home" },
    { href: "/s", label: "Servers" },
    ...(guildId ? SERVER_PAGES.map(({ page, label }) => ({ href: `/s/${guildId}/${page}`, label })) : []),
  ];
  return (
    <nav aria-label="Main">
      <ul className="flex flex-wrap gap-1">
        {links.map(({ href, label }) => {
          const current = pathname === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "block rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-secondary hover:text-foreground active:bg-secondary/60",
                  current ? "bg-secondary text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
