import { BorrowRequests } from "@/components/borrow-requests";
import { ProfileLoans } from "@/components/profile-loans";
import { SettingsLink } from "@/components/profile-stats";
import { LogInPrompt } from "@/components/server-picker";
import { ErrorState, NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { myDiscordId } from "@/lib/me";
import { createClient } from "@/lib/supabase/server";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

const DESCRIPTION = "Riftbound cards you lent and borrowed, and asked to borrow.";

export const metadata = { title: "My loans · nexus", description: DESCRIPTION };

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
  return (
    <>
      <BorrowRequests />
      <LendingSummary />
      <ProfileLoans user={me} own />
    </>
  );
}

const copies = (n: number) => `${n} ${n === 1 ? "copy" : "copies"}`;

/** One line on the copies the visitor lends, counted as Who has it? offers them. */
async function LendingSummary() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("my_lending_summary")
    .maybeSingle<{ lends_cards: boolean; free: number; held: number; lent: number }>();
  // The summary is extra: without it the requests and loans still show.
  if (error || !data) return null;
  if (!data.lends_cards) return <SettingsLink href="/settings#riftbound">You do not lend cards.</SettingsLink>;
  return (
    <p className="text-sm text-muted-foreground">
      You lend {copies(data.free)} · {data.held} held by decks · {data.lent} out on loan
    </p>
  );
}
