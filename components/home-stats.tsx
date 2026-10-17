import { loadStatus } from "@/components/bot-status";
import { Emoji } from "@/components/emoji-stats";
import { utcWeekStart } from "@/components/leaderboard";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import type { ReactNode } from "react";

// shortcut: totals this week's messages over the top channels only; raise if the server
// ever has more channels with messages in one week.
const ALL_CHANNELS = 500;

const fmt = (n: number) => n.toLocaleString("en-US");

interface Stats {
  members?: ReactNode;
  messages?: ReactNode;
  channel?: ReactNode;
  emoji?: ReactNode;
}

/** The four home cards; a missing value shows a dash (no data yet, or no database). */
export function StatCards({ members, messages, channel, emoji }: Stats) {
  const cards = [
    { href: "/timeline", label: "Members", value: members },
    { href: "/leaderboard", label: "Messages this week", value: messages },
    { href: "/channels", label: "Busiest channel this week", value: channel },
    { href: "/emoji", label: "Top emoji", value: emoji },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map(({ href, label, value }) => (
        <Link key={href} href={href} className="card flex flex-col gap-2 active:bg-secondary">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="flex h-8 min-w-0 items-center truncate text-2xl font-semibold tabular-nums">
            {value || <span className="text-muted-foreground">—</span>}
          </span>
        </Link>
      ))}
    </div>
  );
}

export async function HomeStats() {
  const supabase = await createClient();
  const [status, channels, emoji] = await Promise.all([
    loadStatus(),
    supabase.rpc("busiest_channels", { since: utcWeekStart(new Date()), top: ALL_CHANNELS }),
    supabase.rpc("top_emoji", { top: 1 }),
  ]);
  // Each card degrades to a dash on its own, so one failing query does not blank the rest.
  const rows: { name: string; message_count: number }[] = channels.data ?? [];
  const top = emoji.data?.[0];
  return (
    <StatCards
      members={status.data && fmt(status.data.member_count)}
      messages={rows.length > 0 && fmt(rows.reduce((n, r) => n + r.message_count, 0))}
      channel={rows[0] && <span className="truncate" title={`#${rows[0].name}`}>#{rows[0].name}</span>}
      emoji={top && <Emoji row={top} />}
    />
  );
}
