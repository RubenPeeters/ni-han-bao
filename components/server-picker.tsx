import { LoginButton } from "@/components/auth-button";
import { EmptyState, ErrorState } from "@/components/stat-ui";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

interface Guild {
  guild_id: string;
  name: string;
  icon_url: string | null;
}

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
            {g.icon_url ? (
              // Discord CDN icons are already small; same reasoning as member avatars.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={g.icon_url}
                alt=""
                width={40}
                height={40}
                className="size-10 shrink-0 rounded-full bg-muted object-cover"
              />
            ) : (
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground"
              >
                {g.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
