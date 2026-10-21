import { ProfileStats } from "@/components/profile-stats";
import { NotConfigured, StatsSkeleton } from "@/components/stat-ui";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const metadata = {
  title: "Profile · nexus",
  description: "Their activity in the servers you share.",
};

export default function ProfilePage({ params }: PageProps<"/u/[userId]">) {
  return hasEnvVars ? (
    <Suspense fallback={<StatsSkeleton cards={2} />}>
      <ProfileForUser params={params} />
    </Suspense>
  ) : (
    <NotConfigured />
  );
}

async function ProfileForUser({ params }: { params: Promise<{ userId: string }> }) {
  return <ProfileStats user={(await params).userId} />;
}
