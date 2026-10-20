import { NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { TradeStats } from "@/components/trade-stats";
import { memberGuild, serverMetadata } from "@/lib/guild";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

const DESCRIPTION = "Riftbound cards you want that other members have for trade, and where to meet them.";

export const generateMetadata = serverMetadata("Trades", DESCRIPTION);

export default function TradesPage({ params }: PageProps<"/s/[guildId]/trades">) {
  return (
    <>
      <PageHeader title="Trades" description={DESCRIPTION} />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={1} wide />}>
          <TradeStatsForMember params={params} />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
      <p className="text-xs text-muted-foreground">
        Only cards members mark for trade on the Cards page, from members whose profile is not private. No prices or
        payments go through the bot: it introduces you, the trade happens at the table.
      </p>
    </>
  );
}

async function TradeStatsForMember({ params }: { params: Promise<{ guildId: string }> }) {
  return <TradeStats guild={await memberGuild(params)} />;
}
