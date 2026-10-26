import { CollectionImport } from "@/components/collection-import";
import { LogInPrompt } from "@/components/server-picker";
import { ErrorState, NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { myDiscordId } from "@/lib/me";
import { hasEnvVars } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

const DESCRIPTION = "Add the Riftbound cards from a CSV file to your collection and wishlist.";

export const metadata = { title: "Import from CSV · nexus", description: DESCRIPTION };

export default function CollectionImportPage() {
  return (
    <>
      <PageHeader title="Import from CSV" description={DESCRIPTION} />
      <Link href="/collection" className="flex w-fit items-center gap-1 rounded-md text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Back to my collection
      </Link>
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={1} wide />}>
          <Import />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
    </>
  );
}

async function Import() {
  const { me, error } = await myDiscordId();
  if (error) return <ErrorState title="Could not load your collection">Try again in a minute.</ErrorState>;
  if (!me) return <LogInPrompt text="Log in to see and count your Riftbound cards." />;
  return <CollectionImport />;
}
