import { ProfileLoans } from "@/components/profile-loans";
import { LogInPrompt } from "@/components/server-picker";
import { ErrorState, NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { myDiscordId } from "@/lib/me";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

const DESCRIPTION = "Riftbound cards you lent and borrowed.";

export const metadata = { title: "My loans · ni han bao", description: DESCRIPTION };

export default function MyLoansPage() {
  return (
    <>
      <PageHeader title="My loans" description={DESCRIPTION} />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={2} />}>
          <MyLoans />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
    </>
  );
}

async function MyLoans() {
  const { me, error } = await myDiscordId();
  if (error) return <ErrorState title="Could not load your loans">Try again in a minute.</ErrorState>;
  if (!me) return <LogInPrompt text="Log in to see the Riftbound cards you lent and borrowed." />;
  return <ProfileLoans user={me} own />;
}
