import {
  EmptyState,
  ErrorState,
  MemberRankRow,
  RankList,
  StatCard,
  StatGrid,
} from "@/components/stat-ui";
import { createPublicClient } from "@/lib/supabase/public";
import { cacheLife } from "next/cache";

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
  "use cache";
  cacheLife("stats");
  const supabase = createPublicClient();
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
      <Board title="This week" description={`Since Monday ${weekStart} (UTC)`} rows={week.data} />
      <Board title="All time" description="Every message since the bot joined" rows={allTime.data} />
    </StatGrid>
  );
}

function Board({ title, description, rows }: { title: string; description: string; rows: Row[] }) {
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
            />
          ))}
        </RankList>
      )}
    </StatCard>
  );
}
