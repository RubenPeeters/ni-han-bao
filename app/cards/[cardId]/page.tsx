import { CardDetail } from "@/components/card-library";
import { NotConfigured, StatsSkeleton } from "@/components/stat-ui";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const metadata = {
  title: "Card · ni han bao",
  description: "A Riftbound card and all its printings.",
};

export default function CardPage({ params }: PageProps<"/cards/[cardId]">) {
  return hasEnvVars ? (
    <Suspense fallback={<StatsSkeleton cards={1} wide />}>
      <CardForId params={params} />
    </Suspense>
  ) : (
    <NotConfigured />
  );
}

async function CardForId({ params }: { params: Promise<{ cardId: string }> }) {
  return <CardDetail id={(await params).cardId} />;
}
