import { CardCatalogue } from "@/components/card-catalogue";
import { NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { memberGuild, serverMetadata } from "@/lib/guild";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

const DESCRIPTION = "The Riftbound cards the bot knows. Placeholders for now, until Riot's card data is available.";

export const generateMetadata = serverMetadata("Cards", DESCRIPTION);

export default function CardsPage({ params }: PageProps<"/s/[guildId]/cards">) {
  return (
    <>
      <PageHeader title="Cards" description={DESCRIPTION} />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={2} wide />}>
          <CardsForMember params={params} />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
    </>
  );
}

async function CardsForMember({ params }: { params: Promise<{ guildId: string }> }) {
  // The catalogue is the same for every server; the check keeps the 404 for non-members.
  await memberGuild(params);
  return <CardCatalogue />;
}
