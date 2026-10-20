import { ProfileWishlist } from "@/components/profile-wishlist";
import { LogInPrompt } from "@/components/server-picker";
import { ErrorState, NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { myDiscordId } from "@/lib/me";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

const DESCRIPTION = "The Riftbound cards you still want.";

export const metadata = { title: "My wishlist · ni han bao", description: DESCRIPTION };

export default function MyWishlistPage() {
  return (
    <>
      <PageHeader title="My wishlist" description={DESCRIPTION} />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={2} />}>
          <MyWishlist />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
    </>
  );
}

async function MyWishlist() {
  const { me, error } = await myDiscordId();
  if (error) return <ErrorState title="Could not load your wishlist">Try again in a minute.</ErrorState>;
  if (!me) return <LogInPrompt text="Log in to see the Riftbound cards you still want." />;
  return <ProfileWishlist user={me} own />;
}
