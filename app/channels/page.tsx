import { ChannelStats } from "@/components/channel-stats";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const metadata = { title: "Channels · ni han bao" };

export default function ChannelsPage() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-semibold">Channels</h1>
        <p className="text-muted-foreground">Where and when it is busy.</p>
      </div>
      {hasEnvVars ? (
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <ChannelStats />
        </Suspense>
      ) : (
        <p className="text-sm">Supabase env vars are not set.</p>
      )}
    </>
  );
}
