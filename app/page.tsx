import { BotStatus } from "@/components/bot-status";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { hasEnvVars } from "@/lib/utils";
import Link from "next/link";
import { Suspense } from "react";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full max-w-3xl flex flex-col gap-10 p-5">
        <header className="flex justify-between items-center border-b border-b-foreground/10 py-4">
          <h1 className="text-2xl font-bold">ni han bao</h1>
          <ThemeSwitcher />
        </header>
        {hasEnvVars ? (
          <Suspense fallback={<p className="text-sm text-foreground/60">Loading…</p>}>
            <BotStatus />
          </Suspense>
        ) : (
          <p className="text-sm">Supabase env vars are not set.</p>
        )}
        <Link href="/leaderboard" className="text-sm underline underline-offset-4">
          Who talks the most? See the leaderboard →
        </Link>
        <Link href="/channels" className="text-sm underline underline-offset-4">
          Where and when is it busy? See the channels →
        </Link>
        <Link href="/emoji" className="text-sm underline underline-offset-4">
          What does everyone react with? See the emoji →
        </Link>
      </div>
    </main>
  );
}
