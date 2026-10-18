import { Emoji, type EmojiRow } from "@/components/emoji-stats";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  RankList,
  RankRow,
  StatCard,
  StatGrid,
} from "@/components/stat-ui";
import { createClient } from "@/lib/supabase/server";
import { weeklyCounts } from "@/lib/weeks";
import { notFound } from "next/navigation";

const TOP = 10;
const WEEKS = 26;
const DAY_MS = 24 * 60 * 60_000;
const BAR = "hsl(var(--chart-2))";

interface ChannelRow {
  channel_id: string;
  name: string;
  message_count: number;
}

const shortDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** One member of `guild`; the caller has checked the visitor is a member of it. */
export async function MemberStats({ guild, member }: { guild: string; member: string }) {
  const supabase = await createClient();
  const now = new Date();
  const [profile, days, channels, emoji] = await Promise.all([
    // RLS already leaves hidden members out; the filter keeps that true without it.
    supabase
      .from("members")
      .select("display_name")
      .eq("guild_id", guild)
      .eq("user_id", member)
      .eq("hidden", false)
      .maybeSingle(),
    supabase
      .from("message_counts")
      .select("day, count")
      .eq("guild_id", guild)
      .eq("user_id", member)
      .gte("day", new Date(now.getTime() - WEEKS * 7 * DAY_MS).toISOString().slice(0, 10)),
    supabase.rpc("member_top_channels", { guild, member, top: TOP }),
    supabase.rpc("member_top_emoji", { guild, member, top: TOP }),
  ]);

  if (profile.error || days.error || channels.error || emoji.error) {
    return <ErrorState title="Could not load this member">Try again in a minute.</ErrorState>;
  }
  // Hidden (/hide-me) or never seen here: the same 404 as a server the visitor is not in.
  if (!profile.data) notFound();
  return (
    <>
      <PageHeader title={profile.data.display_name} description="Their activity in this server." />
      <StatGrid>
        <Activity rows={weeklyCounts(days.data, now, WEEKS)} />
        <TopChannels rows={channels.data} />
        <TopEmoji rows={emoji.data} />
      </StatGrid>
    </>
  );
}

function Activity({ rows }: { rows: { week: string; count: number }[] }) {
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <StatCard title="Activity" description={`Messages per week (from Monday, UTC), last ${WEEKS} weeks`} wide>
      {max === 0 ? (
        <EmptyState>No messages in the last {WEEKS} weeks.</EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-1" aria-hidden>
            <span className="text-xs tabular-nums text-muted-foreground">{max.toLocaleString("en-US")}</span>
            <div className="flex h-32 items-end gap-1 border-b border-t border-dashed">
              {rows.map((r) => (
                <div
                  key={r.week}
                  title={`Week of ${shortDate(r.week)}: ${r.count.toLocaleString("en-US")} messages`}
                  className="flex h-full flex-1 items-end justify-center rounded-t hover:bg-foreground/5"
                >
                  <span
                    className="block w-full max-w-3 rounded-t-sm"
                    style={{ height: `${(r.count / max) * 100}%`, minHeight: r.count ? 2 : 0, backgroundColor: BAR }}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-1 text-xs text-muted-foreground" aria-hidden>
            {rows.map((r, i) => (
              <span key={r.week} className="flex-1 whitespace-nowrap text-center">
                {i % 8 === 0 ? shortDate(r.week) : ""}
              </span>
            ))}
          </div>
          <div className="sr-only">
            <table>
              <caption>Messages per week</caption>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.week}>
                    <th scope="row">{r.week}</th>
                    <td>{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </StatCard>
  );
}

function TopChannels({ rows }: { rows: ChannelRow[] }) {
  return (
    <StatCard title="Top channels" description="Messages, all time">
      {rows.length === 0 ? (
        <EmptyState>No messages counted yet.</EmptyState>
      ) : (
        <RankList>
          {rows.map((row, i) => (
            <RankRow key={row.channel_id} rank={i + 1} value={row.message_count.toLocaleString("en-US")}>
              <span className="min-w-0 flex-1 truncate">#{row.name}</span>
            </RankRow>
          ))}
        </RankList>
      )}
    </StatCard>
  );
}

function TopEmoji({ rows }: { rows: EmojiRow[] }) {
  return (
    <StatCard title="Top emoji" description="Reactions they added, all time">
      {rows.length === 0 ? (
        <EmptyState>No reactions counted yet.</EmptyState>
      ) : (
        <RankList>
          {rows.map((row, i) => (
            <RankRow key={row.emoji_key} rank={i + 1} value={row.reaction_count.toLocaleString("en-US")}>
              <Emoji row={row} />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {row.emoji_id ? `:${row.name ?? "emoji"}:` : ""}
              </span>
            </RankRow>
          ))}
        </RankList>
      )}
    </StatCard>
  );
}
