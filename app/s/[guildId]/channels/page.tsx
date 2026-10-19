import { ChannelStats } from "@/components/channel-stats";
import { CountingStatus } from "@/components/counting-status";
import { NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { memberGuild, serverMetadata } from "@/lib/guild";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const generateMetadata = serverMetadata("Channels", "Where and when it is busy.");

export default function ChannelsPage({ params }: PageProps<"/s/[guildId]/channels">) {
  return (
    <>
      <PageHeader title="Channels" description="Where and when it is busy." />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={2} wide />}>
          <ChannelStatsForMember params={params} />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
    </>
  );
}

async function ChannelStatsForMember({ params }: { params: Promise<{ guildId: string }> }) {
  const guild = await memberGuild(params);
  return (
    <>
      <CountingStatus guild={guild} />
      <ChannelStats guild={guild} />
    </>
  );
}
