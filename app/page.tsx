import { BotAvatar, HeroAvatar, HeroStatus, StatusPill } from "@/components/bot-status";
import { HomeStats, HomeStatsSkeleton } from "@/components/home-stats";
import { NotConfigured } from "@/components/stat-ui";
import { Button } from "@/components/ui/button";
import { GUILD_ID } from "@/lib/guild";
import { hasEnvVars } from "@/lib/utils";
import Link from "next/link";
import { Suspense } from "react";

export default function Home() {
  return (
    <>
      <section className="hero-dim flex flex-col items-center gap-5 py-6 text-center sm:flex-row sm:items-center sm:gap-8 sm:text-left">
        {hasEnvVars ? (
          <Suspense fallback={<BotAvatar url={null} />}>
            <HeroAvatar />
          </Suspense>
        ) : (
          <BotAvatar url={null} />
        )}
        <div className="flex flex-col items-center gap-3 sm:items-start">
          <h1 className="text-4xl font-semibold">ni han bao</h1>
          <p className="text-lg text-muted-foreground">
            Quietly counting every message, so you can argue about who talks too much.
          </p>
          {hasEnvVars ? (
            <Suspense fallback={<StatusPill tone="unknown">Checking…</StatusPill>}>
              <HeroStatus />
            </Suspense>
          ) : (
            <StatusPill tone="unknown">Status unknown</StatusPill>
          )}
          <Button asChild size="lg" className="mt-2">
            <Link href="/leaderboard">See the leaderboard</Link>
          </Button>
        </div>
      </section>
      {hasEnvVars ? (
        <Suspense fallback={<HomeStatsSkeleton />}>
          <HomeStats guild={GUILD_ID} />
        </Suspense>
      ) : (
        <NotConfigured />
      )}
    </>
  );
}
