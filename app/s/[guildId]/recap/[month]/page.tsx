import { NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { memberGuild, serverMetadata } from "@/lib/guild";
import { recapAlt, recapMonth, type RecapData } from "@/lib/recap";
import { createClient } from "@/lib/supabase/server";
import { hasEnvVars } from "@/lib/utils";
import { notFound } from "next/navigation";
import { Suspense } from "react";

export const generateMetadata = serverMetadata("Monthly recap", "The month in one card, as the bot posts it.");

export default function RecapPage({ params }: PageProps<"/s/[guildId]/recap/[month]">) {
  return (
    <>
      <PageHeader title="Monthly recap" description="The month in one card, as the bot posts it." />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={1} wide />}>
          <RecapForMember params={params} />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
    </>
  );
}

async function RecapForMember({ params }: { params: Promise<{ guildId: string; month: string }> }) {
  const guild = await memberGuild(params);
  const { month: segment } = await params;
  const month = recapMonth(segment);
  if (!month) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("monthly_recap", { guild, month });
  if (error) throw new Error(`monthly_recap failed: ${error.message}`);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the card is already a sized PNG, so no optimisation to gain
    <img
      src={`/s/${guild}/recap/${segment}/og`}
      alt={recapAlt(month, data as RecapData)}
      width={1200}
      height={630}
      className="h-auto w-full rounded-lg border"
    />
  );
}
