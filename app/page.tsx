import {
  AvatarPlaceholder,
  BotAvatar,
  BotStatusPill,
  StatusPill,
} from "@/components/bot-status";
import { HomeStats, StatCards } from "@/components/home-stats";
import { buttonVariants } from "@/components/ui/button";
import { hasEnvVars } from "@/lib/utils";
import Link from "next/link";
import { Suspense } from "react";

const UNKNOWN = <StatusPill label="Status unknown" color="bg-muted-foreground" />;

export default function Home() {
  return (
    <>
      <section className="hero-scroll flex flex-col items-center gap-4 py-6 text-center sm:py-10">
        {hasEnvVars ? (
          <Suspense fallback={<AvatarPlaceholder />}>
            <BotAvatar />
          </Suspense>
        ) : (
          <AvatarPlaceholder />
        )}
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-semibold">ni han bao</h1>
          <p className="text-muted-foreground">Counts every message. Reads none of them.</p>
        </div>
        {hasEnvVars ? (
          <Suspense fallback={UNKNOWN}>
            <BotStatusPill />
          </Suspense>
        ) : (
          UNKNOWN
        )}
        <Link href="/leaderboard" className={buttonVariants({ size: "lg", className: "mt-2" })}>
          See the leaderboard
        </Link>
      </section>
      {hasEnvVars ? (
        <Suspense fallback={<StatCards />}>
          <HomeStats />
        </Suspense>
      ) : (
        <StatCards />
      )}
    </>
  );
}
