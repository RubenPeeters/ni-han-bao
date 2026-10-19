import { CountingStatus } from "@/components/counting-status";
import { EventStats } from "@/components/event-stats";
import { NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { StoreStats } from "@/components/store-stats";
import { memberGuild, serverMetadata } from "@/lib/guild";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const generateMetadata = serverMetadata("Where we play", "The local game stores this server plays at, and who is going where.");

export default function StoresPage({ params }: PageProps<"/s/[guildId]/stores">) {
  return (
    <>
      <PageHeader title="Where we play" description="The local game stores this server plays at, and who is going where." />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={2} wide />}>
          <StoreStatsForMember params={params} />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
    </>
  );
}

async function StoreStatsForMember({ params }: { params: Promise<{ guildId: string }> }) {
  const guild = await memberGuild(params);
  return (
    <>
      <CountingStatus guild={guild} />
      <EventStats guild={guild} />
      <StoreStats guild={guild} />
    </>
  );
}
