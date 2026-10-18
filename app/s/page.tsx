import { LogInPrompt, ServerPicker } from "@/components/server-picker";
import { PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const metadata = {
  title: "Your servers · ni han bao",
  description: "Pick one of your servers. Stats are only shown to members of each server.",
};

export default function ServersPage() {
  return (
    <>
      <PageHeader title="Your servers" description="Stats are only shown to members of each server." />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={1} />}>
          <ServerPicker />
        </Suspense>
      ) : (
        // No Supabase, no session: what a logged-out visitor sees.
        <LogInPrompt />
      )}
    </>
  );
}
