import { TimelineStats } from "@/components/timeline-stats";
import { NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { GUILD_ID } from "@/lib/guild";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const metadata = { title: "Timeline · ni han bao" };

export default function TimelinePage() {
  return (
    <>
      <PageHeader title="Timeline" description="How the server grows, and who hangs out in voice." />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={3} wide />}>
          <TimelineStats guild={GUILD_ID} />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
    </>
  );
}
