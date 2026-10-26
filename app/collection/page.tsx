import { CardLibrary } from "@/components/card-library";
import { CollectionExport } from "@/components/collection-export";
import { ProfileCollection } from "@/components/profile-collection";
import { LogInPrompt } from "@/components/server-picker";
import { ErrorState, NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { Button } from "@/components/ui/button";
import { myDiscordId } from "@/lib/me";
import { hasEnvVars } from "@/lib/utils";
import { Upload } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

const DESCRIPTION = "The Riftbound cards you own: count them here, with the totals below.";

export const metadata = { title: "My collection · nexus", description: DESCRIPTION };

export default function MyCollectionPage() {
  return (
    <>
      <PageHeader
        title="My collection"
        description={DESCRIPTION}
        action={
          hasEnvVars && (
            <Suspense fallback={null}>
              <CollectionActions />
            </Suspense>
          )
        }
      />
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

async function CollectionActions() {
  const { me } = await myDiscordId();
  if (!me) return null;
  return (
    <div className="flex flex-wrap items-start gap-2">
      <Button asChild variant="outline" className="h-11">
        <Link href="/collection/import">
          <Upload aria-hidden />
          Import from CSV
        </Link>
      </Button>
      <CollectionExport />
    </div>
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
