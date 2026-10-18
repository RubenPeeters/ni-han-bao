import { ChannelStats } from "@/components/channel-stats";
import { NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { memberGuild } from "@/lib/guild";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const metadata = { title: "Channels · ni han bao" };

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
  return <ChannelStats guild={await memberGuild(params)} />;
}
