import { ProfileLoans } from "@/components/profile-loans";
import { NotConfigured, StatsSkeleton } from "@/components/stat-ui";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const metadata = {
  title: "Loans · ni han bao",
  description: "Riftbound cards lent between members.",
};

export default function LoansPage({ params }: PageProps<"/u/[userId]/loans">) {
  return hasEnvVars ? (
    <Suspense fallback={<StatsSkeleton cards={2} />}>
      <LoansForUser params={params} />
    </Suspense>
  ) : (
    <NotConfigured />
  );
}

async function LoansForUser({ params }: { params: Promise<{ userId: string }> }) {
  return <ProfileLoans user={(await params).userId} />;
}
