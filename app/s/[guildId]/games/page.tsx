import { CountingStatus } from "@/components/counting-status";
import { GameStats } from "@/components/game-stats";
import { NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { memberGuild, serverMetadata } from "@/lib/guild";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const generateMetadata = serverMetadata("What we play", "The games this server plays most, and who is playing right now.");

export default function GamesPage({ params }: PageProps<"/s/[guildId]/games">) {
  return (
    <>
      <PageHeader title="What we play" description="The games this server plays most, and who is playing right now." />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={2} />}>
          <GameStatsForMember params={params} />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
    </>
  );
}

async function GameStatsForMember({ params }: { params: Promise<{ guildId: string }> }) {
  const guild = await memberGuild(params);
  return (
    <>
      <CountingStatus guild={guild} />
      <GameStats guild={guild} />
    </>
  );
}
