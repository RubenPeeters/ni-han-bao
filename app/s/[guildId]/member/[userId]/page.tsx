import { MemberStats } from "@/components/member-stats";
import { NotConfigured, StatsSkeleton } from "@/components/stat-ui";
import { memberGuild, serverMetadata } from "@/lib/guild";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const generateMetadata = serverMetadata("Member", "Their activity in this server.");

export default function MemberPage({ params }: PageProps<"/s/[guildId]/member/[userId]">) {
  return hasEnvVars ? (
    <Suspense fallback={<StatsSkeleton cards={3} wide />}>
      <MemberStatsForMember params={params} />
    </Suspense>
  ) : (
    <NotConfigured />
  );
}

async function MemberStatsForMember({ params }: { params: Promise<{ guildId: string; userId: string }> }) {
  const guild = await memberGuild(params);
  return <MemberStats guild={guild} member={(await params).userId} />;
}
