import { ProfileWishlist } from "@/components/profile-wishlist";
import { NotConfigured, StatsSkeleton } from "@/components/stat-ui";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const metadata = {
  title: "Wishlist · nexus",
  description: "The Riftbound cards they want.",
};

export default function WishlistPage({ params }: PageProps<"/u/[userId]/wishlist">) {
  return hasEnvVars ? (
    <Suspense fallback={<StatsSkeleton cards={2} />}>
      <WishlistForUser params={params} />
    </Suspense>
  ) : (
    <NotConfigured />
  );
}

async function WishlistForUser({ params }: { params: Promise<{ userId: string }> }) {
  return <ProfileWishlist user={(await params).userId} />;
}
