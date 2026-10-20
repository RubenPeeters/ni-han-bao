import { DeckVersionDetail } from "@/components/decks";
import { NotConfigured, StatsSkeleton } from "@/components/stat-ui";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const metadata = {
  title: "Deck version · ni han bao",
  description: "A saved version of a Riftbound deck.",
};

export default function DeckVersionPage({ params, searchParams }: PageProps<"/decks/[deckId]/versions/[version]">) {
  return hasEnvVars ? (
    <Suspense fallback={<StatsSkeleton cards={3} />}>
      <VersionFor params={params} searchParams={searchParams} />
    </Suspense>
  ) : (
    <NotConfigured />
  );
}

async function VersionFor({
  params,
  searchParams,
}: {
  params: Promise<{ deckId: string; version: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ deckId, version }, { from }] = await Promise.all([params, searchParams]);
  return <DeckVersionDetail id={deckId} version={version} from={typeof from === "string" ? from : undefined} />;
}
