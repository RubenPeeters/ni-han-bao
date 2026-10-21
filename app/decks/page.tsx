import { DeckList } from "@/components/decks";
import { NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

const DESCRIPTION = "Your Riftbound decks: search or paste their cards, with the rules as warnings.";

export const metadata = { title: "Decks · nexus", description: DESCRIPTION };

export default function DecksPage() {
  return (
    <>
      <PageHeader title="Decks" description={DESCRIPTION} />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={1} wide />}>
          <DeckList />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
    </>
  );
}
