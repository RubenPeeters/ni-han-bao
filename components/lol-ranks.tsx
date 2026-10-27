import { EmptyState, ErrorState, MemberRankRow, RankList, RankRow, StatCard, StatGrid } from "@/components/stat-ui";
import { loadChampionIcons, loadChampions } from "@/lib/champion-icons";
import { championIcon, championKey } from "@/lib/ddragon";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const QUEUES = [
  { queue: "RANKED_SOLO_5x5", label: "Solo/Duo" },
  { queue: "RANKED_FLEX_SR", label: "Flex" },
];

export interface Rank {
  tier: string;
  /** Null for Master and above. */
  division: string | null;
  lp: number;
}

interface GuildRank extends Rank {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
}

const tierName = (tier: string) => tier.charAt(0) + tier.slice(1).toLowerCase();

/** Riot's own tier, division and LP, as Riot writes them; never a computed score (Riot policy). */
export function rankText({ tier, division, lp }: Rank): string {
  return `${tierName(tier)}${division ? ` ${division}` : ""} · ${lp.toLocaleString("en-US")} LP`;
}

/** Riot's official ranked emblem (from the developer portal's ranked emblems, in public/ranked). */
export function RankEmblem({ tier, size }: { tier: string; size: number }) {
  return (
    // Static files already sized for this; no optimisation needed.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/ranked/${tier.toLowerCase()}.png`} alt="" width={size} height={size} className="shrink-0" />
  );
}

/** The champion's square icon from Riot's Data Dragon, then "mostly <champion>". */
function MostlyChampion({ champion, icons, size }: { champion: string; icons: Record<string, string>; size: number }) {
  const src = championIcon(icons, champion);
  return (
    <>
      {src && (
        // Riot's CDN serves them small already; next/image would need a remote pattern.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-sm bg-muted" />
      )}
      <span className="truncate">mostly {champion}</span>
    </>
  );
}

/** The server's Ranked page: linked members by official rank, one card per queue. */
export async function GuildRanks({ guild }: { guild: string }) {
  const supabase = await createClient();
  const results = await Promise.all(QUEUES.map(({ queue }) => supabase.rpc("guild_ranks", { g: guild, q: queue })));
  if (results.some((r) => r.error)) {
    return <ErrorState title="Could not load the ranks">Try again in a minute.</ErrorState>;
  }
  return (
    <StatGrid>
      {QUEUES.map(({ queue, label }, i) => {
        const rows = results[i].data as GuildRank[];
        return (
          <StatCard key={queue} title={label} description="Riot's official rank, updated every 3 hours">
            {rows.length === 0 ? (
              <EmptyState>Nobody is ranked here yet. Link your League account with /lol link in Discord.</EmptyState>
            ) : (
              <RankList>
                {rows.map((r, n) => (
                  <RankRow key={r.user_id} rank={n + 1} value={`${r.lp.toLocaleString("en-US")} LP`}>
                    <RankEmblem tier={r.tier} size={32} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <Link
                        href={`/s/${guild}/member/${r.user_id}`}
                        className="truncate underline-offset-4 hover:text-gold hover:underline"
                      >
                        {r.display_name}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {tierName(r.tier)}
                        {r.division && ` ${r.division}`}
                      </span>
                    </span>
                  </RankRow>
                ))}
              </RankList>
            )}
          </StatCard>
        );
      })}
    </StatGrid>
  );
}

interface LolWeek {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  games: number;
  champion: string | null;
}

/** The server's League week: linked members' ranked and normal games. Nothing when no one linked. */
export async function GuildLolWeek({ guild }: { guild: string }) {
  const supabase = await createClient();
  const [{ data, error }, icons] = await Promise.all([supabase.rpc("guild_lol_week", { g: guild }), loadChampionIcons()]);
  if (error) return <ErrorState title="Could not load the League games">Try again in a minute.</ErrorState>;
  const rows = (data as LolWeek[]).filter((r) => r.games > 0);
  if (data.length === 0) return null;
  return (
    <StatCard title="League" description="Ranked and normal games in the last 7 days, updated every 6 hours" wide>
      {rows.length === 0 ? (
        <EmptyState>Nobody played League this week.</EmptyState>
      ) : (
        <RankList>
          {rows.map((r, n) => (
            <MemberRankRow
              key={r.user_id}
              rank={n + 1}
              name={r.display_name}
              avatarUrl={r.avatar_url}
              detail={r.champion && <MostlyChampion champion={r.champion} icons={icons} size={16} />}
              value={`${r.games.toLocaleString("en-US")} ${r.games === 1 ? "game" : "games"}`}
              href={`/s/${guild}/member/${r.user_id}`}
            />
          ))}
        </RankList>
      )}
    </StatCard>
  );
}

/** The profile's League card; nothing without a ranked queue, a game this week or a favourite. */
export async function ProfileRanks({
  ranks,
  champion,
  favourite,
}: {
  ranks: (Rank & { queue: string })[];
  champion: string | null;
  favourite: string | null;
}) {
  if (ranks.length === 0 && !champion && !favourite) return null;
  const champions = champion || favourite ? await loadChampions() : [];
  // Ids ("MonkeyKing") and Match-V5's spellings both to the name people know, with its icon.
  const find = (c: string) => champions.find((x) => championKey(x.id) === championKey(c) || championKey(x.name) === championKey(c));
  const picks = [
    { label: "Favourite", champion: favourite },
    { label: "Most played this week", champion },
  ].filter((p): p is { label: string; champion: string } => !!p.champion);
  return (
    <StatCard title="League of Legends" description="Riot's official rank, updated every 3 hours">
      <ul className="grid gap-4 sm:grid-cols-2">
        {QUEUES.map(({ queue, label }) => {
          const rank = ranks.find((r) => r.queue === queue);
          return (
            <li key={queue} className="flex min-w-0 items-center gap-3">
              {rank ? (
                <RankEmblem tier={rank.tier} size={56} />
              ) : (
                <span aria-hidden className="size-14 shrink-0 rounded-full bg-muted" />
              )}
              <span className="flex min-w-0 flex-col">
                <span className="text-xs text-muted-foreground">{label}</span>
                <span className="font-medium tabular-nums">{rank ? rankText(rank) : "Unranked"}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {picks.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2">
          {picks.map((p) => {
            const c = find(p.champion);
            return (
              <li key={p.label} className="flex min-w-0 items-center gap-3">
                {/* The emblems' width, so the names line up with the ranks above. */}
                <span className="flex w-14 shrink-0 justify-center">
                  {c ? (
                    // Riot's CDN serves them small already; next/image would need a remote pattern.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.icon} alt="" width={40} height={40} className="rounded-md bg-muted" />
                  ) : (
                    <span aria-hidden className="size-10 rounded-md bg-muted" />
                  )}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-xs text-muted-foreground">{p.label}</span>
                  <span className="truncate font-medium">{c?.name ?? p.champion}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </StatCard>
  );
}
