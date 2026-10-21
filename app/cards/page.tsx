import { CardLibrary } from "@/components/card-library";
import { NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

const DESCRIPTION = "Every Riftbound card the bot knows, from Riot's own card gallery.";

export const metadata = { title: "Cards · nexus", description: DESCRIPTION };

export default function CardsPage() {
  return (
    <>
      <PageHeader title="Cards" description={DESCRIPTION} />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={1} wide />}>
          <CardLibrary />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
    </>
  );
}
