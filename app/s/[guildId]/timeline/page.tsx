import { TimelineStats } from "@/components/timeline-stats";
import { CountingStatus } from "@/components/counting-status";
import { NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { memberGuild, serverMetadata } from "@/lib/guild";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const generateMetadata = serverMetadata("Timeline", "How the server grows, and who hangs out in voice.");

export default function TimelinePage({ params }: PageProps<"/s/[guildId]/timeline">) {
  return (
    <>
      <PageHeader title="Timeline" description="How the server grows, and who hangs out in voice." />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={3} wide />}>
          <TimelineStatsForMember params={params} />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
    </>
  );
}

async function TimelineStatsForMember({ params }: { params: Promise<{ guildId: string }> }) {
  const guild = await memberGuild(params);
  return (
    <>
      <CountingStatus guild={guild} />
      <TimelineStats guild={guild} />
    </>
  );
}
