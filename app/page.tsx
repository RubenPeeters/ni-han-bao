import { BotStatus } from "@/components/bot-status";
import { hasEnvVars } from "@/lib/utils";
import Link from "next/link";
import { Suspense } from "react";

const SECTIONS = [
  { href: "/leaderboard", title: "Leaderboard", text: "Who talks the most?" },
  { href: "/channels", title: "Channels", text: "Where and when is it busy?" },
  { href: "/emoji", title: "Emoji", text: "What does everyone react with?" },
  { href: "/timeline", title: "Timeline", text: "How is the server growing, and who hangs out in voice?" },
];

export default function Home() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-semibold">ni han bao</h1>
        <p className="text-muted-foreground">Fun statistics about our Discord server.</p>
      </div>
      {hasEnvVars ? (
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <BotStatus />
        </Suspense>
      ) : (
        <p className="text-sm">Supabase env vars are not set.</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map(({ href, title, text }) => (
          <Link key={href} href={href} className="card flex flex-col gap-1 active:bg-secondary">
            <span className="text-lg font-semibold">{title} →</span>
            <span className="text-sm text-muted-foreground">{text}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
