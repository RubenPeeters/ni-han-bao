import { LoginButton } from "@/components/auth-button";
import { EmptyState, ErrorState } from "@/components/stat-ui";
import { createClient } from "@/lib/supabase/server";
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

/** The header's server row; the visitor's servers feed its switcher. Anon gets none. */
export async function ServerBar() {
  const supabase = await createClient();
  // The header must not take the page down with it: without the list the tabs still work.
  const { data } = await supabase.rpc("my_guilds");
  return <ServerNav guilds={(data ?? []) as Guild[]} />;
}
