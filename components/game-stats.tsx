import { formatSeconds } from "@/components/profile-stats";
import { EmptyState, ErrorState, RankList, RankRow, StatCard, StatGrid } from "@/components/stat-ui";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

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
  const me = await supabase.rpc("current_discord_id");
  const [games, now, mine] = await Promise.all([
    supabase.rpc("guild_games", { g: guild, since }),
    supabase.rpc("guild_playing_now", { g: guild }),
    // The visitor's own row is always visible to them; no row means game time is off.
    supabase.from("profiles").select("count_games").eq("user_id", me.data ?? "").maybeSingle<{ count_games: boolean }>(),
  ]);
  if (games.error || now.error) {
    return <ErrorState title="Could not load the games">Try again in a minute.</ErrorState>;
  }
  const top = (games.data as Game[]).filter((g) => g.seconds >= 60);
  const playing = now.data as PlayingNow[];
  return (
    <>
      {!me.error && !mine.error && !mine.data?.count_games && (
        <p className="text-sm text-muted-foreground">
          Game time is only counted for members who switch it on:{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">/profile games on</code>, or on{" "}
          <Link href="/settings#profile" className="underline underline-offset-4 hover:text-foreground">
            Settings
          </Link>
          .
        </p>
      )}
      <StatGrid>
        <StatCard title="Top games" description={`Hours played by members who count their game time, last ${DAYS} days`}>
          {top.length === 0 ? (
            <EmptyState>No games yet. They show up here once members who switched game time on play.</EmptyState>
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
    </>
  );
}
