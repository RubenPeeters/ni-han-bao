"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUser } from "@/components/auth-button";
import { currentRiftboundTab, riftboundTabs } from "@/lib/riftbound-pages";
import { SERVER_GROUPS, switchPath } from "@/lib/server-pages";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

export interface Guild {
  guild_id: string;
  name: string;
  icon_url: string | null;
}

const tab = (current: boolean) =>
  cn(
    "flex min-h-11 items-center whitespace-nowrap rounded-md px-2 text-sm sm:px-3 transition-colors hover:bg-secondary hover:text-foreground active:bg-secondary/60",
    current ? "bg-secondary text-foreground shadow-[inset_0_-2px_0_hsl(var(--crystal))]" : "text-muted-foreground",
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

// The brand links home, so the site-wide sections left are the servers, Riftbound and the docs.
// Server pages have their own row of tabs, so only the picker itself marks Servers.
export function MainNav({ pathname }: { pathname: string | null }) {
  const main = [
    { href: "/s", label: "Servers", current: pathname === "/s" },
    { href: "/cards", label: "Riftbound", current: !!currentRiftboundTab(pathname) },
    { href: "/docs", label: "Docs", current: pathname === "/docs" || !!pathname?.startsWith("/docs/") },
  ];
  return (
    <nav aria-label="Main">
      <ul className="flex sm:gap-1">
        {main.map(({ href, label, current }) => (
          <li key={href}>
            <Link href={href} aria-current={current ? "page" : undefined} className={tab(current)}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SiteNav() {
  return <MainNav pathname={usePathname()} />;
}

/** The second row on Riftbound pages: the catalogue, and the member's own collection pages. */
export function RiftboundNav() {
  const pathname = usePathname();
  // Logged in is enough: the own pages read the Discord id on the server.
  const loggedIn = !!useUser();
  const current = currentRiftboundTab(pathname);
  if (!current) return null;
  return (
    // Pulled up against the header, as its second row, like the server row.
    <nav aria-label="Riftbound" className="-mt-6">
      <ul className="flex flex-wrap sm:gap-1">
        {riftboundTabs(loggedIn).map(({ href, label }) => (
          <li key={href}>
            <Link href={href} aria-current={href === current ? "page" : undefined} className={tab(href === current)}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
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
  if (!guildId) return null;
  const others = guilds.filter((g) => g.guild_id !== guildId);
  const label = guild && (
    <>
      <GuildIcon guild={guild} className="size-6 text-xs" />
      <span className="truncate">{guild.name}</span>
    </>
  );
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2">
      {guild &&
        (others.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Server: ${guild.name}. Switch server`}
              className="flex min-h-11 min-w-0 max-w-full shrink-0 items-center gap-2 rounded-md px-2 text-sm font-medium transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:max-w-56"
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
          <span className="flex min-h-11 min-w-0 max-w-full shrink-0 items-center gap-2 px-2 text-sm font-medium sm:max-w-56">
            {label}
          </span>
        ))}
      <nav aria-label="Server">
        <ul className="flex gap-1">
          {SERVER_GROUPS.map(({ label, pages }) => {
            const hrefs = pages.map(({ page }) => `/s/${guildId}/${page}`);
            const at = hrefs.indexOf(pathname);
            if (pages.length === 1) {
              return (
                <li key={label}>
                  <Link href={hrefs[0]} aria-current={at === 0 ? "page" : undefined} className={tab(at === 0)}>
                    {pages[0].label}
                  </Link>
                </li>
              );
            }
            return (
              <li key={label}>
                <DropdownMenu>
                  {/* On one of its pages the group shows that page, so the row says where you are. */}
                  <DropdownMenuTrigger
                    className={cn(tab(at >= 0), "gap-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring")}
                  >
                    {at >= 0 ? pages[at].label : label}
                    <ChevronDown aria-hidden className="size-4 shrink-0" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {pages.map((p, i) => (
                      <DropdownMenuItem key={p.page} asChild className="min-h-11">
                        <Link href={hrefs[i]} aria-current={i === at ? "page" : undefined}>
                          {p.label}
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
