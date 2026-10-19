import { formatSeconds } from "@/components/profile-stats";
import { EmptyState, ErrorState, RankList, RankRow, StatCard, StatGrid } from "@/components/stat-ui";
import { createClient } from "@/lib/supabase/server";

interface Game {
  name: string;
  seconds: number;
  players: number;
  application_id: string | null;
  icon: string | null;
}

interface PlayingNow {
  kind: "playing" | "streaming" | "competing";
  name: string;
  players: string[];
  others: number;
}

const DAYS = 30;
const VERB = { playing: "Playing", streaming: "Streaming on", competing: "Competing in" };

/** The Discord application icon (the bot stores the hash), or the game's initial as for members. */
function GameIcon({ name, application_id, icon }: Game) {
  if (application_id && icon) {
    return (
      // Discord CDN icons are already small, as for avatars: no next/image.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`https://cdn.discordapp.com/app-icons/${application_id}/${icon}.png?size=64`}
        alt=""
        width={28}
        height={28}
        className="size-7 shrink-0 rounded-md bg-muted object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Who is named: members whose profile is not private (the database decides, see guild_playing_now()). */
function who({ players, others }: PlayingNow): string {
  const rest = others ? [`${others} ${players.length ? "other" : "member"}${others === 1 ? "" : "s"}`] : [];
  return [...players, ...rest].join(", ");
}

export async function GameStats({ guild }: { guild: string }) {
  const supabase = await createClient();
  const since = new Date(Date.now() - (DAYS - 1) * 24 * 60 * 60_000).toISOString().slice(0, 10);
  const [games, now] = await Promise.all([
    supabase.rpc("guild_games", { g: guild, since }),
    supabase.rpc("guild_playing_now", { g: guild }),
  ]);
  if (games.error || now.error) {
    return <ErrorState title="Could not load the games">Try again in a minute.</ErrorState>;
  }
  const top = (games.data as Game[]).filter((g) => g.seconds >= 60);
  const playing = now.data as PlayingNow[];
  return (
    <StatGrid>
      <StatCard title="Top games" description={`Hours played by this server's members, last ${DAYS} days`}>
        {top.length === 0 ? (
          <EmptyState>No games yet. They show up here once members play with their Discord status on.</EmptyState>
        ) : (
          <RankList>
            {top.map((g, i) => (
              <RankRow key={g.name} rank={i + 1} value={formatSeconds(g.seconds)}>
                <GameIcon {...g} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{g.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {g.players.toLocaleString("en-US")} {g.players === 1 ? "player" : "players"}
                  </span>
                </span>
              </RankRow>
            ))}
          </RankList>
        )}
      </StatCard>
      <StatCard title="Playing now" description="Only members whose profile is not private are named">
        {playing.length === 0 ? (
          <EmptyState>Nobody is playing right now.</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y">
            {playing.map((p) => (
              <li key={`${p.kind}:${p.name}`} className="flex min-w-0 flex-col py-2 text-sm first:pt-0 last:pb-0">
                <span className="truncate">
                  <span className="text-muted-foreground">{VERB[p.kind]}</span> {p.name}
                </span>
                <span className="text-xs text-muted-foreground">{who(p)}</span>
              </li>
            ))}
          </ul>
        )}
      </StatCard>
    </StatGrid>
  );
}
