"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SERVER_PAGES, switchPath } from "@/lib/server-pages";
import { cn } from "@/lib/utils";
import { ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export interface Guild {
  guild_id: string;
  name: string;
  icon_url: string | null;
}

const tab = (current: boolean) =>
  cn(
    "block whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-secondary hover:text-foreground active:bg-secondary/60",
    current ? "bg-secondary text-foreground" : "text-muted-foreground",
  );

export function GuildIcon({ guild, className }: { guild: Guild; className: string }) {
  return guild.icon_url ? (
    // Discord CDN icons are already small; same reasoning as member avatars.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={guild.icon_url} alt="" className={cn("shrink-0 rounded-full bg-muted object-cover", className)} />
  ) : (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground",
        className,
      )}
    >
      {guild.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

// The brand links home, so the site-wide pages left are the server picker, the cards, the decks and the docs.
// Server pages have their own row of tabs, so only the picker itself marks Servers; a card page marks Cards.
const MAIN = [
  { href: "/s", label: "Servers", nested: false },
  { href: "/cards", label: "Cards", nested: true },
  { href: "/decks", label: "Decks", nested: true },
  { href: "/docs", label: "Docs", nested: true },
];

export function MainNav({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Main">
      <ul className="flex gap-1">
        {MAIN.map(({ href, label, nested }) => {
          const current = pathname === href || (nested && !!pathname?.startsWith(`${href}/`));
          return (
            <li key={href}>
              <Link href={href} aria-current={current ? "page" : undefined} className={tab(current)}>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SiteNav() {
  return <MainNav pathname={usePathname()} />;
}

/** A profile's two tabs: activity in shared servers, and the Riftbound collection. */
export function ProfileNav({ user }: { user: string }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/u/${user}`, label: "Activity" },
    { href: `/u/${user}/collection`, label: "Collection" },
    { href: `/u/${user}/loans`, label: "Loans" },
    { href: `/u/${user}/wishlist`, label: "Wishlist" },
  ];
  return (
    <nav aria-label="Profile">
      <ul className="flex gap-1">
        {tabs.map(({ href, label }) => (
          <li key={href}>
            <Link href={href} aria-current={pathname === href ? "page" : undefined} className={tab(pathname === href)}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The row on top of server pages: which server this is, and its tabs. */
export function ServerNav({ guild, guilds }: { guild: Guild | null; guilds: Guild[] }) {
  const pathname = usePathname();
  const { guildId } = useParams<{ guildId?: string }>();
  const tabs = useRef<HTMLElement>(null);

  // On a phone the tabs scroll sideways; bring the current one into view on every page.
  useEffect(() => {
    const nav = tabs.current;
    const active = nav?.querySelector<HTMLElement>("[aria-current=page]");
    if (nav && active) nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
  }, [pathname]);

  if (!guildId) return null;
  const others = guilds.filter((g) => g.guild_id !== guildId);
  const label = guild && (
    <>
      <GuildIcon guild={guild} className="size-6 text-xs" />
      <span className="truncate">{guild.name}</span>
    </>
  );
  return (
    <div className="flex min-w-0 items-center gap-2">
      {guild &&
        (others.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Server: ${guild.name}. Switch server`}
              className="flex min-w-0 max-w-[40%] shrink-0 items-center gap-2 rounded-md px-2 py-1 text-sm font-medium transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:max-w-56"
            >
              {label}
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-w-72">
              {others.map((g) => (
                <DropdownMenuItem key={g.guild_id} asChild>
                  <Link href={switchPath(pathname, g.guild_id)}>
                    <GuildIcon guild={g} className="size-6 text-xs" />
                    <span className="truncate">{g.name}</span>
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="flex min-w-0 max-w-[40%] shrink-0 items-center gap-2 px-2 py-1 text-sm font-medium sm:max-w-56">
            {label}
          </span>
        ))}
      <nav ref={tabs} aria-label="Server" className="relative min-w-0 flex-1 overflow-x-auto">
        <ul className="flex gap-1">
          {SERVER_PAGES.map(({ page, label }) => {
            const href = `/s/${guildId}/${page}`;
            return (
              <li key={page}>
                <Link
                  href={href}
                  aria-current={pathname === href ? "page" : undefined}
                  className={tab(pathname === href)}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
