import { ChannelStats } from "@/components/channel-stats";
import { NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const metadata = { title: "Channels · ni han bao" };

export default function ChannelsPage() {
  return (
    <>
      <PageHeader title="Channels" description="Where and when it is busy." />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={2} wide />}>
          <ChannelStats />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
    </>
  );
}
