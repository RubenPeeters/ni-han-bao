import { EmojiStats } from "@/components/emoji-stats";
import { CountingStatus } from "@/components/counting-status";
import { NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { memberGuild, serverMetadata } from "@/lib/guild";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const generateMetadata = serverMetadata("Emoji", "What everyone reacts with.");

export default function EmojiPage({ params }: PageProps<"/s/[guildId]/emoji">) {
  return (
    <>
      <PageHeader title="Emoji" description="What everyone reacts with." />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={2} />}>
          <EmojiStatsForMember params={params} />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
    </>
  );
}

async function EmojiStatsForMember({ params }: { params: Promise<{ guildId: string }> }) {
  const guild = await memberGuild(params);
  return (
    <>
      <CountingStatus guild={guild} />
      <EmojiStats guild={guild} />
    </>
  );
}
