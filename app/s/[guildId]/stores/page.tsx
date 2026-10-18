import { CountingStatus } from "@/components/counting-status";
import { NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { StoreStats } from "@/components/store-stats";
import { memberGuild } from "@/lib/guild";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const metadata = {
  title: "Where we play · ni han bao",
  description: "The local game stores this server plays at.",
};

export default function StoresPage({ params }: PageProps<"/s/[guildId]/stores">) {
  return (
    <>
      <PageHeader title="Where we play" description="The local game stores this server plays at." />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={1} wide />}>
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
      <StoreStats guild={guild} />
    </>
  );
}
