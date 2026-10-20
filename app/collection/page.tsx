import { CardLibrary } from "@/components/card-library";
import { ProfileCollection } from "@/components/profile-collection";
import { LogInPrompt } from "@/components/server-picker";
import { ErrorState, NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { myDiscordId } from "@/lib/me";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

const DESCRIPTION = "The Riftbound cards you own: count them here, with the totals below.";

export const metadata = { title: "My collection · ni han bao", description: DESCRIPTION };

export default function MyCollectionPage() {
  return (
    <>
      <PageHeader title="My collection" description={DESCRIPTION} />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={1} wide />}>
          <MyCollection />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
    </>
  );
}

async function MyCollection() {
  const { me, error } = await myDiscordId();
  if (error) return <ErrorState title="Could not load your collection">Try again in a minute.</ErrorState>;
  if (!me) return <LogInPrompt text="Log in to see and count your Riftbound cards." />;
  return (
    <>
      <CardLibrary owned />
      <Suspense fallback={<StatsSkeleton cards={3} />}>
        <ProfileCollection user={me} own />
      </Suspense>
    </>
  );
}
