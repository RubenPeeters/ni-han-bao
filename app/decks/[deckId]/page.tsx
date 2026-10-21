import { DeckDetail } from "@/components/decks";
import { NotConfigured, StatsSkeleton } from "@/components/stat-ui";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const metadata = {
  title: "Deck · nexus",
  description: "A Riftbound deck.",
};

export default function DeckPage({ params }: PageProps<"/decks/[deckId]">) {
  return hasEnvVars ? (
    <Suspense fallback={<StatsSkeleton cards={3} />}>
      <DeckForId params={params} />
    </Suspense>
  ) : (
    <NotConfigured />
  );
}

async function DeckForId({ params }: { params: Promise<{ deckId: string }> }) {
  return <DeckDetail id={(await params).deckId} />;
}
