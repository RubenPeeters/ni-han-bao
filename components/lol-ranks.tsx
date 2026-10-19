import { EmptyState, ErrorState, RankList, RankRow, StatCard, StatGrid } from "@/components/stat-ui";
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
                        className="truncate underline-offset-4 hover:text-primary hover:underline"
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

/** The profile's League card; nothing without a ranked queue. */
export function ProfileRanks({ ranks }: { ranks: (Rank & { queue: string })[] }) {
  if (ranks.length === 0) return null;
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
    </StatCard>
  );
}
