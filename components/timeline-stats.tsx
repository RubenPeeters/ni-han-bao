import {
  EmptyState,
  ErrorState,
  MemberRankRow,
  RankList,
  StatCard,
  StatGrid,
} from "@/components/stat-ui";
import { guildTimeZone } from "@/lib/guild";
import { countingSince, WARMUP_DAYS, warmingUp } from "@/lib/history";
import { createClient } from "@/lib/supabase/server";
import { localDay } from "@/lib/time";

const TOP = 10;
const DAY_MS = 24 * 60 * 60_000;
const HISTORY_DAYS = 365;
const WEEKS = 12;
const LINE = "hsl(var(--chart-2))";
const GRID = "hsl(var(--border))";
const JOINS = "hsl(var(--chart-2))";
const LEAVES = "hsl(var(--chart-1))";

interface SnapshotRow {
  day: string;
  member_count: number;
}

interface WeekRow {
  week: string;
  joins: number;
  leaves: number;
}

interface VoiceRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  voice_minutes: number;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Monday (UTC) of the week `ms` falls in, as YYYY-MM-DD; matches Postgres date_trunc('week'). */
function weekStart(ms: number): string {
  const day = new Date(ms).getUTCDay(); // 0 = Sunday
  return isoDay(ms - ((day + 6) % 7) * DAY_MS);
}

/** The last WEEKS weeks, oldest first, zeros filled in for weeks without any. */
function weeklyFlow(rows: WeekRow[], now: number): WeekRow[] {
  const byWeek = new Map(rows.map((r) => [r.week, r]));
  const current = Date.parse(weekStart(now));
  return Array.from({ length: WEEKS }, (_, i) => {
    const week = isoDay(current - (WEEKS - 1 - i) * 7 * DAY_MS);
    return byWeek.get(week) ?? { week, joins: 0, leaves: 0 };
  });
}

const shortDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export async function TimelineStats({ guild }: { guild: string }) {
  const supabase = await createClient();
  const timeZone = await guildTimeZone(guild);
  // Today on the server's calendar, as midnight UTC: the bot stores these days as its local days.
  const now = Date.parse(localDay(new Date(), timeZone));
  const monthStart = `${isoDay(now).slice(0, 7)}-01`;
  const [snapshots, flow, voice, state] = await Promise.all([
    supabase
      .from("member_count_snapshots")
      .select("day, member_count")
      .eq("guild_id", guild)
      .gte("day", isoDay(now - HISTORY_DAYS * DAY_MS))
      .order("day"),
    supabase.rpc("weekly_member_flow", {
      since: weekStart(now - (WEEKS - 1) * 7 * DAY_MS),
      guild,
    }),
    supabase.rpc("top_voice_members", { since: monthStart, top: TOP, guild }),
    supabase.from("backfill_state").select("before_id").eq("guild_id", guild).maybeSingle(),
  ]);
  // Member counts and joins are only counted live, never backfilled, so their first days
  // would chart as a sudden start. A failed read of the state just shows the charts.
  const warming = !!state.data && warmingUp(countingSince(state.data.before_id), new Date());

  if (snapshots.error || flow.error || voice.error) {
    return <ErrorState title="Could not load the timeline">Try again in a minute.</ErrorState>;
  }
  return (
    <StatGrid>
      <MemberCount rows={snapshots.data} warming={warming} timeZone={timeZone} />
      <JoinsLeaves rows={weeklyFlow(flow.data, now)} warming={warming} timeZone={timeZone} />
      <TopVoice rows={voice.data} timeZone={timeZone} />
    </StatGrid>
  );
}

function MemberCount({ rows, warming, timeZone }: { rows: SnapshotRow[]; warming: boolean; timeZone: string }) {
  // The SVG stretches to its box (preserveAspectRatio="none") and H matches its CSS height,
  // so y() is in pixels and the HTML axis labels line up; labels inside a scaled SVG
  // would shrink to unreadable on a phone.
  const W = 600;
  const H = 160;
  const PAD = 8;
  const counts = rows.map((r) => r.member_count);
  const lo = Math.min(...counts);
  const hi = Math.max(...counts);
  // A flat line still needs a range to sit in the middle of.
  const span = hi - lo || 1;
  const x = (i: number) => (rows.length === 1 ? 0.5 : i / (rows.length - 1)) * W;
  const y = (n: number) => PAD + (1 - (n - lo) / span) * (H - 2 * PAD);
  const first = rows[0];
  const last = rows.at(-1);
  const ticks = [...new Set([hi, lo])];
  const points = rows.map((r, i) => `${x(i)},${y(r.member_count)}`).join(" ");
  return (
    <StatCard
      title="Members"
      description={`Member count per day, ${timeZone}, last ${HISTORY_DAYS} days${
        last ? ` · now ${last.member_count.toLocaleString("en-US")}` : ""
      }`}
      wide
    >
      {warming ? (
        <WarmingUp />
      ) : !first || !last ? (
        <EmptyState>The member count per day appears here once the bot has recorded one.</EmptyState>
      ) : (
        <>
          <div className="flex gap-2 text-xs tabular-nums text-muted-foreground">
            <div className="relative h-40 shrink-0" aria-hidden>
              {/* Invisible copy of the widest label gives the absolutely placed labels a width. */}
              <span className="invisible">{hi.toLocaleString("en-US")}</span>
              {ticks.map((n) => (
                <span key={n} className="absolute right-0 -translate-y-1/2" style={{ top: y(n) }}>
                  {n.toLocaleString("en-US")}
                </span>
              ))}
            </div>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              className="h-40 min-w-0 flex-1 overflow-visible"
              role="img"
              aria-label={`Member count went from ${first.member_count.toLocaleString("en-US")} on ${shortDate(first.day)} to ${last.member_count.toLocaleString("en-US")} on ${shortDate(last.day)}.`}
            >
              {[...new Set([hi, (hi + lo) / 2, lo])].map((n) => (
                <line
                  key={n}
                  x1={0}
                  x2={W}
                  y1={y(n)}
                  y2={y(n)}
                  stroke={GRID}
                  strokeDasharray={n === lo ? undefined : "4 4"}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              <polygon points={`${x(0)},${y(lo)} ${points} ${x(rows.length - 1)},${y(lo)}`} fill={LINE} fillOpacity={0.12} />
              <polyline
                points={points}
                fill="none"
                stroke={LINE}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {rows.map((r, i) => {
                // Invisible hit target per day, wider than the line, for the hover tooltip.
                const width = W / rows.length;
                return (
                  <rect
                    key={r.day}
                    x={x(i) - width / 2}
                    y={0}
                    width={width}
                    height={H}
                    fill="transparent"
                    className="hover:fill-foreground/5"
                  >
                    <title>{`${shortDate(r.day)}: ${r.member_count.toLocaleString("en-US")} members`}</title>
                  </rect>
                );
              })}
            </svg>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground" aria-hidden>
            <span>{shortDate(first.day)}</span>
            <span>{shortDate(last.day)}</span>
          </div>
          <div className="sr-only">
            <table>
              <caption>Member count per day</caption>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.day}>
                    <th scope="row">{r.day}</th>
                    <td>{r.member_count}</td>
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

function JoinsLeaves({ rows, warming, timeZone }: { rows: WeekRow[]; warming: boolean; timeZone: string }) {
  const max = Math.max(...rows.flatMap((r) => [r.joins, r.leaves]));
  const bar = (n: number, color: string) => (
    <span
      className="block w-full max-w-2 rounded-t-sm"
      style={{ height: `${(n / max) * 100}%`, minHeight: n ? 2 : 0, backgroundColor: color }}
    />
  );
  return (
    <StatCard
      title="Joins vs leaves"
      description={`Per week (from Monday, ${timeZone}), last ${WEEKS} weeks`}
      wide
      aside={
        <ul className="flex gap-3 text-xs text-muted-foreground">
          <li className="flex items-center gap-1">
            <span className="size-2 rounded-sm" style={{ backgroundColor: JOINS }} /> Joins
          </li>
          <li className="flex items-center gap-1">
            <span className="size-2 rounded-sm" style={{ backgroundColor: LEAVES }} /> Leaves
          </li>
        </ul>
      }
    >
      {warming ? (
        <WarmingUp />
      ) : max === 0 ? (
        <EmptyState>Weekly joins and leaves appear here once someone joins or leaves.</EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-1" aria-hidden>
            <span className="text-xs tabular-nums text-muted-foreground">{max.toLocaleString("en-US")}</span>
            <div className="flex h-32 items-end gap-1 border-b border-t border-dashed">
              {rows.map((r) => (
                <div
                  key={r.week}
                  title={`Week of ${shortDate(r.week)}: ${r.joins} joined, ${r.leaves} left`}
                  className="flex h-full flex-1 items-end justify-center gap-0.5 rounded-t hover:bg-foreground/5"
                >
                  {bar(r.joins, JOINS)}
                  {bar(r.leaves, LEAVES)}
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-1 text-xs text-muted-foreground" aria-hidden>
            {rows.map((r, i) => (
              <span key={r.week} className="flex-1 whitespace-nowrap text-center">
                {i % 3 === 0 ? shortDate(r.week) : ""}
              </span>
            ))}
          </div>
          <div className="sr-only">
            <table>
              <caption>Joins and leaves per week</caption>
              <thead>
                <tr>
                  <th scope="col">Week of</th>
                  <th scope="col">Joins</th>
                  <th scope="col">Leaves</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.week}>
                    <th scope="row">{r.week}</th>
                    <td>{r.joins}</td>
                    <td>{r.leaves}</td>
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

function WarmingUp() {
  return <EmptyState>Warming up: this chart appears after {WARMUP_DAYS} days of counting.</EmptyState>;
}

function TopVoice({ rows, timeZone }: { rows: VoiceRow[]; timeZone: string }) {
  return (
    <StatCard title="Top voice members" description={`Time in voice channels this month (${timeZone})`} wide>
      {rows.length === 0 ? (
        <EmptyState>The top voice members this month appear here once someone joins voice.</EmptyState>
      ) : (
        <RankList>
          {rows.map((row, i) => (
            <MemberRankRow
              key={row.user_id}
              rank={i + 1}
              name={row.display_name}
              avatarUrl={row.avatar_url}
              value={formatMinutes(row.voice_minutes)}
            />
          ))}
        </RankList>
      )}
    </StatCard>
  );
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h.toLocaleString("en-US")} h ${m} min` : `${m} min`;
}
