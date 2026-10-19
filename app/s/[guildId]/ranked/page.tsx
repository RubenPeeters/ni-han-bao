import { GuildRanks } from "@/components/lol-ranks";
import { NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { memberGuild } from "@/lib/guild";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const metadata = {
  title: "Ranked · ni han bao",
  description: "League ranks of the members who linked their account.",
};

export default function RankedPage({ params }: PageProps<"/s/[guildId]/ranked">) {
  return (
    <>
      <PageHeader title="Ranked" description="League ranks of the members who linked their account." />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={2} />}>
          <RanksForMember params={params} />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
    </>
  );
}

async function RanksForMember({ params }: { params: Promise<{ guildId: string }> }) {
  const guild = await memberGuild(params);
  return <GuildRanks guild={guild} />;
}
