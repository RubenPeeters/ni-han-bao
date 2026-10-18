import { Leaderboard } from "@/components/leaderboard";
import { CountingStatus } from "@/components/counting-status";
import { NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { memberGuild } from "@/lib/guild";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const metadata = {
  title: "Leaderboard · ni han bao",
  description: "Who talks the most.",
};

export default function LeaderboardPage({ params }: PageProps<"/s/[guildId]/leaderboard">) {
  return (
    <>
      <PageHeader title="Leaderboard" description="Who talks the most." />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={2} />}>
          <LeaderboardForMember params={params} />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
    </>
  );
}

async function LeaderboardForMember({ params }: { params: Promise<{ guildId: string }> }) {
  const guild = await memberGuild(params);
  return (
    <>
      <CountingStatus guild={guild} />
      <Leaderboard guild={guild} />
    </>
  );
}
