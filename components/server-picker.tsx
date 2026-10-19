import { LoginButton } from "@/components/auth-button";
import { EmptyState, ErrorState } from "@/components/stat-ui";
import { guildInfo, guildTimeZone } from "@/lib/guild";
import { serverSummary } from "@/lib/home";
import { createClient } from "@/lib/supabase/server";
import { weekStart } from "@/lib/time";
import { GuildIcon, ServerNav, type Guild } from "@/components/site-nav";
import Link from "next/link";

export function LogInPrompt() {
  return (
    <div className="flex flex-col items-start gap-4">
      <p className="text-muted-foreground">Log in to see the stats of the servers you are in.</p>
      <LoginButton size="lg" />
    </div>
  );
}

export async function ServerPicker() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return <LogInPrompt />;

  const { data, error } = await supabase.rpc("my_guilds");
  if (error) {
    return <ErrorState title="Could not load your servers">Try again in a minute.</ErrorState>;
  }
  if (data.length === 0) {
    return <EmptyState>The bot is not in any of your servers yet.</EmptyState>;
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {(data as Guild[]).map((g) => (
        <li key={g.guild_id}>
          <Link
            href={`/s/${g.guild_id}/leaderboard`}
            className="card flex min-w-0 items-center gap-3 active:bg-secondary"
          >
            <GuildIcon guild={g} className="size-10" />
            <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The logged-in home: the picker's cards with this week's messages and the visitor's rank.
 * profile_servers() of the visitor themselves lists exactly their servers, with their rank.
 */
export async function MyServers() {
  const supabase = await createClient();
  const me = await supabase.rpc("current_discord_id");
  const servers = me.error ? me : await supabase.rpc("profile_servers", { u: me.data });
  if (servers.error) {
    return <ErrorState title="Could not load your servers">Try again in a minute.</ErrorState>;
  }
  const guilds = servers.data as (Guild & { rank: number | null })[];
  if (guilds.length === 0) {
    return <EmptyState>The bot is not in any of your servers yet.</EmptyState>;
  }
  const now = new Date();
  const weeks = await Promise.all(
    guilds.map(async (g) =>
      supabase.rpc("message_total", { since: weekStart(now, await guildTimeZone(g.guild_id)), guild: g.guild_id }),
    ),
  );
  if (weeks.some((w) => w.error)) {
    return <ErrorState title="Could not load your servers">Try again in a minute.</ErrorState>;
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {guilds.map((g, i) => (
        <li key={g.guild_id}>
          <Link
            href={`/s/${g.guild_id}/leaderboard`}
            className="card flex min-w-0 items-center gap-3 active:bg-secondary"
          >
            <GuildIcon guild={g} className="size-10" />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate font-medium">{g.name}</span>
              <span className="text-sm text-muted-foreground">{serverSummary(weeks[i].data, g.rank)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The server row; the visitor's servers feed its switcher. */
export async function ServerBar({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const supabase = await createClient();
  // The row must not take the page down with it: without the list the tabs still work.
  const [{ data }, guild] = await Promise.all([supabase.rpc("my_guilds"), guildInfo(guildId)]);
  return <ServerNav guild={guild} guilds={(data ?? []) as Guild[]} />;
}
