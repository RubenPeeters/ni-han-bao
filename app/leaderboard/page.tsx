import { Leaderboard } from "@/components/leaderboard";
import { NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { GUILD_ID } from "@/lib/guild";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const metadata = { title: "Leaderboard · ni han bao" };

export default function LeaderboardPage() {
  return (
    <>
      <PageHeader title="Leaderboard" description="Who talks the most." />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={2} />}>
          <Leaderboard guild={GUILD_ID} />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
    </>
  );
}
