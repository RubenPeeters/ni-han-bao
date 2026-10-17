import { createClient } from "@/lib/supabase/server";

const TOP = 10;
const DAY_MS = 24 * 60 * 60_000;
const FLOW_WEEKS = 12;
const CHART_W = 600;
const CHART_H = 160;

interface CountDay {
  day: string;
  member_count: number;
}

interface FlowWeek {
  week: string; // Monday, YYYY-MM-DD (UTC)
  joins: number;
  leaves: number;
}

interface VoiceRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  seconds: number;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Monday 00:00 UTC of the week containing `now`, in ms. */
function utcWeekStart(now: Date): number {
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday);
}

/** The last FLOW_WEEKS weeks, oldest first, with zeros for weeks nobody joined or left. */
function fillWeeks(rows: FlowWeek[], firstWeek: number): FlowWeek[] {
  const byWeek = new Map(rows.map((r) => [r.week, r]));
  return Array.from({ length: FLOW_WEEKS }, (_, i) => {
    const week = isoDay(firstWeek + i * 7 * DAY_MS);
    return byWeek.get(week) ?? { week, joins: 0, leaves: 0 };
  });
}

/** "2 h 05 min", or "12 min" under an hour. */
function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h.toLocaleString("en-US")} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

export async function Timeline() {
  const supabase = await createClient();
  const now = new Date();
  const firstWeek = utcWeekStart(now) - (FLOW_WEEKS - 1) * 7 * DAY_MS;
  const monthStart = isoDay(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [counts, flow, voice] = await Promise.all([
    supabase.from("member_count_days").select("day, member_count").order("day"),
    supabase.rpc("member_flow_weekly", { since: isoDay(firstWeek) }),
    supabase.rpc("top_voice", { since: monthStart, top: TOP }),
  ]);

  if (counts.error || flow.error || voice.error) {
    return <p className="text-sm text-red-600">Could not load the timeline.</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      <MemberCount days={counts.data} />
      <JoinsLeaves weeks={fillWeeks(flow.data, firstWeek)} />
      <TopVoice rows={voice.data} since={monthStart} />
    </div>
  );
}

function MemberCount({ days }: { days: CountDay[] }) {
  const values = days.map((d) => d.member_count);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Pad a flat line off the edges so it does not sit on the border.
  const lo = min === max ? min - 1 : min;
  const hi = min === max ? max + 1 : max;
  const x = (i: number) => (days.length === 1 ? CHART_W / 2 : (i / (days.length - 1)) * CHART_W);
  const y = (v: number) => CHART_H - ((v - lo) / (hi - lo)) * CHART_H;
  const points = days.map((d, i) => `${x(i)},${y(d.member_count)}`).join(" ");
  const last = days.at(-1);
  return (
    <section className="rounded-lg border p-5 flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Members</h2>
        <p className="text-xs text-foreground/60">Member count at the end of each day (UTC)</p>
      </div>
      {!last ? (
        <p className="text-sm text-foreground/60">No member counts recorded yet.</p>
      ) : (
        <>
          <p className="text-sm">
            <span className="text-2xl font-semibold tabular-nums">
              {last.member_count.toLocaleString("en-US")}
            </span>{" "}
            members now
          </p>
          <div className="flex gap-2 text-[10px] text-foreground/60">
            <div className="flex flex-col justify-between tabular-nums text-right">
              <span>{max.toLocaleString("en-US")}</span>
              <span>{min.toLocaleString("en-US")}</span>
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <svg
                viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                preserveAspectRatio="none"
                className="w-full h-40 overflow-visible"
                role="img"
                aria-label={`Member count from ${days[0].day} (${days[0].member_count}) to ${last.day} (${last.member_count})`}
              >
                <polyline
                  points={days.length === 1 ? `0,${y(last.member_count)} ${points} ${CHART_W},${y(last.member_count)}` : points}
                  fill="none"
                  stroke="hsl(var(--chart-2))"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <div className="flex justify-between">
                <span>{days[0].day}</span>
                {days.length > 1 && <span>{last.day}</span>}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function JoinsLeaves({ weeks }: { weeks: FlowWeek[] }) {
  const max = Math.max(...weeks.flatMap((w) => [w.joins, w.leaves]));
  const bar = (value: number, color: string, label: string) => (
    <span
      title={label}
      className="flex-1 rounded-t"
      style={{ height: `${(value / max) * 100}%`, backgroundColor: color }}
    >
      <span className="sr-only">{label}</span>
    </span>
  );
  return (
    <section className="rounded-lg border p-5 flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Joins vs leaves</h2>
        <p className="text-xs text-foreground/60">
          Per week (Monday to Sunday, UTC), last {FLOW_WEEKS} weeks
        </p>
      </div>
      {max === 0 ? (
        <p className="text-sm text-foreground/60">Nobody joined or left yet.</p>
      ) : (
        <>
          <div className="flex gap-4 text-xs">
            <span className="flex items-center gap-1">
              <span className="size-3 rounded-sm" style={{ backgroundColor: "hsl(var(--chart-2))" }} />
              Joins
            </span>
            <span className="flex items-center gap-1">
              <span className="size-3 rounded-sm" style={{ backgroundColor: "hsl(var(--chart-1))" }} />
              Leaves
            </span>
          </div>
          <div className="flex items-end gap-2 h-32 border-b border-foreground/10">
            {weeks.map((w) => (
              <div key={w.week} className="flex-1 h-full flex items-end gap-0.5">
                {bar(w.joins, "hsl(var(--chart-2))", `Week of ${w.week}: ${w.joins} joined`)}
                {bar(w.leaves, "hsl(var(--chart-1))", `Week of ${w.week}: ${w.leaves} left`)}
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-foreground/60">
            <span>{weeks[0].week}</span>
            <span>{weeks.at(-1)!.week}</span>
          </div>
        </>
      )}
    </section>
  );
}

function TopVoice({ rows, since }: { rows: VoiceRow[]; since: string }) {
  return (
    <section className="rounded-lg border p-5 flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Most time in voice</h2>
        <p className="text-xs text-foreground/60">This month, since {since} (UTC)</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-foreground/60">No voice time this month yet.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <li key={row.user_id} className="flex items-center gap-3 text-sm">
              <span className="w-5 text-right text-foreground/60">{i + 1}</span>
              {row.avatar_url ? (
                // Same as the leaderboard: Discord CDN avatars are already small.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.avatar_url} alt="" width={28} height={28} className="rounded-full" />
              ) : (
                <span className="size-7 rounded-full bg-foreground/10" />
              )}
              <span className="flex-1 truncate">{row.display_name}</span>
              <span className="tabular-nums">{formatDuration(row.seconds)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
