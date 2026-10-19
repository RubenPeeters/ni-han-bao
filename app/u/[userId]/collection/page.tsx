import { ProfileCollection } from "@/components/profile-collection";
import { NotConfigured, StatsSkeleton } from "@/components/stat-ui";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const metadata = {
  title: "Collection · ni han bao",
  description: "Their Riftbound cards, per set and rarity.",
};

export default function CollectionPage({ params }: PageProps<"/u/[userId]/collection">) {
  return hasEnvVars ? (
    <Suspense fallback={<StatsSkeleton cards={2} />}>
      <CollectionForUser params={params} />
    </Suspense>
  ) : (
    <NotConfigured />
  );
}

async function CollectionForUser({ params }: { params: Promise<{ userId: string }> }) {
  return <ProfileCollection user={(await params).userId} />;
}
