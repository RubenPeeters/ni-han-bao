import { Leaderboard } from "@/components/leaderboard";
import { hasEnvVars } from "@/lib/utils";
import { Suspense } from "react";

export const metadata = { title: "Leaderboard · ni han bao" };

export default function LeaderboardPage() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-semibold">Leaderboard</h1>
        <p className="text-muted-foreground">Who talks the most.</p>
      </div>
      {hasEnvVars ? (
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <Leaderboard />
        </Suspense>
      ) : (
        <p className="text-sm">Supabase env vars are not set.</p>
      )}
    </>
  );
}
