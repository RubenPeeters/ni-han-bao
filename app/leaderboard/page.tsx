import { Leaderboard } from "@/components/leaderboard";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { hasEnvVars } from "@/lib/utils";
import Link from "next/link";
import { Suspense } from "react";

const loading = <p className="text-sm text-foreground/60">Loading…</p>;

export default function LeaderboardPage() {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full max-w-3xl flex flex-col gap-10 p-5">
        <header className="flex justify-between items-center border-b border-b-foreground/10 py-4">
          <h1 className="text-2xl font-bold">
            <Link href="/">ni han bao</Link> · leaderboard
          </h1>
          <ThemeSwitcher />
        </header>
        {hasEnvVars ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <Suspense fallback={loading}>
              <Leaderboard view="leaderboard_this_week" title="This week (Mon–Sun, UTC)" />
            </Suspense>
            <Suspense fallback={loading}>
              <Leaderboard view="leaderboard_all_time" title="All time" />
            </Suspense>
          </div>
        ) : (
          <p className="text-sm">Supabase env vars are not set.</p>
        )}
      </div>
    </main>
  );
}
