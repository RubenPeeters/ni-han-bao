import {
  EmptyState,
  ErrorState,
  MemberRankRow,
  RankList,
  StatCard,
  StatGrid,
} from "@/components/stat-ui";
import { createClient } from "@/lib/supabase/server";

const TOP = 10;

interface Row {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  message_count: number;
}

/** Monday 00:00 UTC of the week containing `now`, as YYYY-MM-DD. */
export function utcWeekStart(now: Date): string {
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday),
  );
  return monday.toISOString().slice(0, 10);
}

export async function Leaderboard({ guild }: { guild: string }) {
  const supabase = await createClient();
  const weekStart = utcWeekStart(new Date());
  const [week, allTime] = await Promise.all([
    supabase.rpc("leaderboard", { since: weekStart, top: TOP, guild }),
    supabase.rpc("leaderboard", { top: TOP, guild }),
  ]);

  if (week.error || allTime.error) {
    return <ErrorState title="Could not load the leaderboard">Try again in a minute.</ErrorState>;
  }
  return (
    <StatGrid>
      <Board guild={guild} title="This week" description={`Since Monday ${weekStart} (UTC)`} rows={week.data} />
      <Board guild={guild} title="All time" description="Every message since the bot joined" rows={allTime.data} />
    </StatGrid>
  );
}

function Board({
  guild,
  title,
  description,
  rows,
}: {
  guild: string;
  title: string;
  description: string;
  rows: Row[];
}) {
  return (
    <StatCard title={title} description={description}>
      {rows.length === 0 ? (
        <EmptyState>No messages counted yet.</EmptyState>
      ) : (
        <RankList>
          {rows.map((row, i) => (
            <MemberRankRow
              key={row.user_id}
              rank={i + 1}
              name={row.display_name}
              avatarUrl={row.avatar_url}
              value={row.message_count.toLocaleString("en-US")}
              href={`/s/${guild}/member/${row.user_id}`}
            />
          ))}
        </RankList>
      )}
    </StatCard>
  );
}
