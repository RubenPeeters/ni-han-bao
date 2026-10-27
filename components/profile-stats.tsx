import { Emoji } from "@/components/emoji-stats";
import { ProfileRanks, type Rank } from "@/components/lol-ranks";
import { ProfileNav } from "@/components/site-nav";
import { EmptyState, ErrorState, RankList, RankRow, StatCard } from "@/components/stat-ui";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

interface Server {
  guild_id: string;
  name: string;
  icon_url: string | null;
  message_count: number;
  voice_seconds: number;
  rank: number | null;
}

export interface Profile {
  display_name: string | null;
  avatar_url: string | null;
  visibility: string | null;
  mine: boolean;
}

interface Badges {
  channel_name: string | null;
  channel_guild: string | null;
  emoji_key: string | null;
  emoji_id: string | null;
  emoji_name: string | null;
  emoji_animated: boolean | null;
  longest_streak: number | null;
}

export const VISIBILITIES = [
  { value: "private", label: "Private", hint: "Only you." },
  { value: "members", label: "Server members", hint: "People who share a server with you see the servers you share." },
  { value: "public", label: "Public", hint: "Anyone logged in sees your name; people who share a server with you also see your stats and badges there." },
];

interface GameTime {
  /** Null for the streaming total. */
  name: string | null;
  seconds: number;
}

export function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const h = Math.floor(minutes / 60);
  return h ? `${h.toLocaleString("en-US")} h ${minutes % 60} min` : `${minutes} min`;
}

/**
 * One Discord user across servers. The database decides who may see it (profile(),
 * profile_servers(), profile_badges() all check can_see_profile()), so this only renders.
 */
export async function ProfileStats({ user }: { user: string }) {
  const supabase = await createClient();
  const [profile, servers, badges, games, ranks, champion, favourite] = await Promise.all([
    supabase.rpc("profile", { u: user }).maybeSingle<Profile>(),
    supabase.rpc("profile_servers", { u: user }),
    supabase.rpc("profile_badges", { u: user }).maybeSingle<Badges>(),
    supabase.rpc("profile_games", { u: user }),
    supabase.rpc("profile_ranks", { u: user }),
    supabase.rpc("profile_lol_champion", { u: user }),
    supabase.rpc("profile_favourite_champion", { u: user }),
  ]);
  if (profile.error || servers.error || badges.error || games.error || ranks.error) {
    return <ErrorState title="Could not load this profile">Try again in a minute.</ErrorState>;
  }
  // Private, hidden, forgotten or unknown: the same 404 as a page that does not exist.
  if (!profile.data) notFound();
  const { visibility, mine } = profile.data;
  const badge = badges.data;
  const gameRows = games.data as GameTime[];
  const topGames = gameRows.filter((g) => g.name !== null && g.seconds >= 60).slice(0, 5);
  const streaming = gameRows.find((g) => g.name === null)?.seconds ?? 0;
  return (
    <>
      <ProfileHeader
        user={user}
        profile={profile.data}
        subtitle={mine ? "Your activity in every server you are in." : "Their activity in the servers you share."}
      />
      {badge && (
        <ul className="flex flex-wrap gap-2" aria-label="Badges">
          {badge.channel_name && (
            <li>
              <Badge variant="secondary" className="max-w-full">
                <span className="truncate">
                  Most active in #{badge.channel_name} ({badge.channel_guild})
                </span>
              </Badge>
            </li>
          )}
          {badge.emoji_key && (
            <li>
              <Badge variant="secondary" className="gap-1 py-0">
                Top emoji
                <Emoji
                  row={{
                    emoji_key: badge.emoji_key,
                    emoji_id: badge.emoji_id,
                    name: badge.emoji_name,
                    animated: badge.emoji_animated ?? false,
                    reaction_count: 0,
                  }}
                />
              </Badge>
            </li>
          )}
          {(badge.longest_streak ?? 0) > 0 && (
            <li>
              <Badge variant="secondary">Longest streak: {badge.longest_streak?.toLocaleString("en-US")} days</Badge>
            </li>
          )}
        </ul>
      )}
      {mine && (
        <SettingsLink href="/settings#profile">
          Who can see your profile: <span className="font-medium">{VISIBILITIES.find((v) => v.value === visibility)?.label ?? "Private"}</span>.
        </SettingsLink>
      )}
      <ProfileRanks
        ranks={ranks.data as (Rank & { queue: string })[]}
        // Decoration only: a failed champion lookup drops it, not the profile.
        champion={champion.error ? null : (champion.data as string | null)}
        favourite={favourite.error ? null : (favourite.data as string | null)}
      />
      {(topGames.length > 0 || streaming >= 60) && (
        <StatCard title="Games" description="Last 30 days, from Discord's Playing and Streaming status">
          {topGames.length > 0 && (
            <RankList>
              {topGames.map((g, i) => (
                <RankRow key={g.name} rank={i + 1} value={formatSeconds(g.seconds)}>
                  <span className="min-w-0 flex-1 truncate">{g.name}</span>
                </RankRow>
              ))}
            </RankList>
          )}
          {streaming >= 60 && (
            <p className="text-sm">
              Streaming: <span className="font-medium tabular-nums">{formatSeconds(streaming)}</span>
            </p>
          )}
        </StatCard>
      )}
      {servers.data.length === 0 ? (
        <EmptyState>{mine ? "The bot is not in any of your servers yet." : "You share no servers with them."}</EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {(servers.data as Server[]).map((s) => (
            <li key={s.guild_id}>
              <Link
                href={`/s/${s.guild_id}/member/${user}`}
                className="card flex min-w-0 flex-col gap-4 active:bg-secondary"
              >
                <span className="flex min-w-0 items-center gap-3">
                  {s.icon_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.icon_url} alt="" width={40} height={40} className="size-10 shrink-0 rounded-full bg-muted object-cover" />
                  ) : (
                    <span
                      aria-hidden
                      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground"
                    >
                      {s.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                </span>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  {[
                    ["Messages", s.message_count.toLocaleString("en-US")],
                    ["Voice", formatSeconds(s.voice_seconds)],
                    ["Rank", s.rank ? `#${s.rank.toLocaleString("en-US")}` : "–"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex min-w-0 flex-col">
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="font-medium tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Name, avatar and the profile's tabs, on every tab of a profile; `manage` is your own page of the tab. */
export function ProfileHeader({ user, profile, subtitle, manage }: { user: string; profile: Profile; subtitle: string; manage?: string }) {
  const name = profile.display_name ?? "You";
  return (
    <>
      <div className="flex min-w-0 items-center gap-4">
        {profile.avatar_url ? (
          // Discord CDN avatars are already small; same as the leaderboard.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.avatar_url} alt="" width={64} height={64} className="size-16 shrink-0 rounded-full bg-muted object-cover" />
        ) : (
          <span
            aria-hidden
            className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted text-2xl font-semibold text-muted-foreground"
          >
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="truncate text-4xl font-semibold">{name}</h1>
          <p className="text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <ProfileNav user={user} />
      {manage && profile.mine && (
        <Link href={manage} className="flex min-h-11 w-fit items-center rounded-md text-sm font-medium text-crystal underline underline-offset-4 hover:text-crystal/80">
          Manage in Riftbound
        </Link>
      )}
    </>
  );
}

/** One line on your own profile tabs, pointing at the setting's section of /settings. */
export function SettingsLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p className="text-sm text-muted-foreground">
      {children}{" "}
      <Link href={href} className="font-medium text-crystal underline underline-offset-4 hover:text-crystal/80">
        Change it in Settings
      </Link>
    </p>
  );
}
