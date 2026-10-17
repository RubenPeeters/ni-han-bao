import { TimelineStats } from "@/components/timeline-stats";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const metadata = { title: "Timeline · ni han bao" };

export default function TimelinePage() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-semibold">Timeline</h1>
        <p className="text-muted-foreground">How the server grows, and who hangs out in voice.</p>
      </div>
      {hasEnvVars ? (
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <TimelineStats />
        </Suspense>
      ) : (
        <p className="text-sm">Supabase env vars are not set.</p>
      )}
    </>
  );
}
