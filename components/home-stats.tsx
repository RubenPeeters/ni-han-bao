import { loadStatus } from "@/components/bot-status";
import { Emoji, type EmojiRow } from "@/components/emoji-stats";
import { utcWeekStart } from "@/components/leaderboard";
import { ErrorState } from "@/components/stat-ui";
import { GUILD_ID } from "@/lib/guild";
import { createPublicClient } from "@/lib/supabase/public";
import { cacheLife } from "next/cache";
import Link from "next/link";
import type { ReactNode } from "react";

const fmt = (n: number) => n.toLocaleString("en-US");

// Cached apart from loadStatus(), which must stay live.
async function loadWeekStats() {
  "use cache";
  cacheLife("minutes");
  const supabase = createPublicClient();
  const weekStart = utcWeekStart(new Date());
  const [messages, channel, emoji] = await Promise.all([
    supabase.rpc("message_total", { since: weekStart, guild: GUILD_ID }),
    supabase.rpc("busiest_channels", {
      since: `${weekStart}T00:00:00Z`,
      top: 1,
      guild: GUILD_ID,
    }),
    supabase.rpc("top_emoji", { since: weekStart, top: 1, guild: GUILD_ID }),
  ]);

  if (messages.error || channel.error || emoji.error) return null;
  return {
    messages: (messages.data as number | null) ?? 0,
    busiest: channel.data[0] as { name: string; message_count: number } | undefined,
    topEmoji: emoji.data[0] as EmojiRow | undefined,
  };
}

export async function HomeStats() {
  const [status, week] = await Promise.all([loadStatus(), loadWeekStats()]);

  if (status.error || !week) {
    return <ErrorState title="Could not load server stats">Try again in a minute.</ErrorState>;
  }
  const { messages, busiest, topEmoji } = week;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <HomeStat href="/timeline" label="Members">
        {status.data ? fmt(status.data.member_count) : <Empty>Not seen yet</Empty>}
      </HomeStat>
      <HomeStat href="/leaderboard" label="Messages this week">
        {fmt(messages)}
      </HomeStat>
      <HomeStat href="/channels" label="Busiest channel this week">
        {busiest ? <span className="block truncate" title={`#${busiest.name}`}>#{busiest.name}</span> : <Empty>No messages yet</Empty>}
      </HomeStat>
      <HomeStat href="/emoji" label="Top emoji this week">
        {topEmoji ? (
          <span className="flex items-center gap-2">
            <Emoji row={topEmoji} />
            <span className="text-sm text-muted-foreground">{fmt(topEmoji.reaction_count)}×</span>
          </span>
        ) : (
          <Empty>No reactions yet</Empty>
        )}
      </HomeStat>
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return <span className="text-base font-normal text-muted-foreground">{children}</span>;
}

function HomeStat({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <Link href={href} className="card flex min-w-0 flex-col gap-2 active:bg-secondary">
      <span className="text-xs text-muted-foreground">{label} →</span>
      <span className="min-h-8 text-2xl font-semibold tabular-nums">{children}</span>
    </Link>
  );
}

/** Suspense fallback shaped like the cards, so content does not jump when it streams in. */
export function HomeStatsSkeleton() {
  return (
    <div role="status" aria-busy className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} aria-hidden className="card flex animate-pulse flex-col gap-2">
          <div className="h-4 w-24 rounded bg-muted" />
          <div className="h-8 w-16 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
