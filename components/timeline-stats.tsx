import { createClient } from "@/lib/supabase/server";

const TOP = 10;
const DAY_MS = 24 * 60 * 60_000;
const HISTORY_DAYS = 365;
const WEEKS = 12;
const LINE = "hsl(var(--chart-2))";
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

export async function TimelineStats() {
  const supabase = await createClient();
  const now = Date.now();
  const monthStart = `${isoDay(now).slice(0, 7)}-01`;
  const [snapshots, flow, voice] = await Promise.all([
    supabase
      .from("member_count_snapshots")
      .select("day, member_count")
      .gte("day", isoDay(now - HISTORY_DAYS * DAY_MS))
      .order("day"),
    supabase.rpc("weekly_member_flow", { since: weekStart(now - (WEEKS - 1) * 7 * DAY_MS) }),
    supabase.rpc("top_voice_members", { since: monthStart, top: TOP }),
  ]);

  if (snapshots.error || flow.error || voice.error) {
    return <p className="text-sm text-destructive">Could not load the timeline.</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      <MemberCount rows={snapshots.data} />
      <JoinsLeaves rows={weeklyFlow(flow.data, now)} />
      <TopVoice rows={voice.data} />
    </div>
  );
}

function MemberCount({ rows }: { rows: SnapshotRow[] }) {
  const W = 600;
  const H = 160;
  const PAD = { top: 10, right: 10, bottom: 20, left: 40 };
  const counts = rows.map((r) => r.member_count);
  const lo = Math.min(...counts);
  const hi = Math.max(...counts);
  // A flat line still needs a range to sit in the middle of.
  const span = hi - lo || 1;
  const x = (i: number) =>
    PAD.left + (rows.length === 1 ? 0.5 : i / (rows.length - 1)) * (W - PAD.left - PAD.right);
  const y = (n: number) => PAD.top + (1 - (n - lo) / span) * (H - PAD.top - PAD.bottom);
  const last = rows.at(-1);
  return (
    <section className="card flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Members</h2>
        <p className="text-xs text-muted-foreground">
          Member count per day, UTC, last {HISTORY_DAYS} days
          {last ? ` · now ${last.member_count.toLocaleString("en-US")}` : ""}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No member counts recorded yet.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto text-xs text-muted-foreground" aria-hidden>
            {[hi, lo].map((n) => (
              <g key={n}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(n)}
                  y2={y(n)}
                  stroke="currentColor"
                  strokeOpacity={0.15}
                />
                <text x={PAD.left - 6} y={y(n) + 3} textAnchor="end" fill="currentColor">
                  {n.toLocaleString("en-US")}
                </text>
              </g>
            ))}
            <text x={PAD.left} y={H - 4} fill="currentColor">
              {shortDate(rows[0].day)}
            </text>
            <text x={W - PAD.right} y={H - 4} textAnchor="end" fill="currentColor">
              {shortDate(rows[rows.length - 1].day)}
            </text>
            <polyline
              points={rows.map((r, i) => `${x(i)},${y(r.member_count)}`).join(" ")}
              fill="none"
              stroke={LINE}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {rows.map((r, i) => {
              // Invisible hit target per day, wider than the line, for the hover tooltip.
              const width = (W - PAD.left - PAD.right) / Math.max(rows.length, 1);
              return (
                <rect
                  key={r.day}
                  x={x(i) - width / 2}
                  y={PAD.top}
                  width={width}
                  height={H - PAD.top - PAD.bottom}
                  fill="transparent"
                  className="hover:fill-foreground/5"
                >
                  <title>{`${shortDate(r.day)}: ${r.member_count.toLocaleString("en-US")} members`}</title>
                </rect>
              );
            })}
          </svg>
          <table className="sr-only">
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
        </>
      )}
    </section>
  );
}

function JoinsLeaves({ rows }: { rows: WeekRow[] }) {
  const max = Math.max(...rows.flatMap((r) => [r.joins, r.leaves]));
  const bar = (n: number, color: string) => (
    <span
      className="block w-2 rounded-t"
      style={{ height: `${(n / max) * 100}%`, minHeight: n ? 2 : 0, backgroundColor: color }}
    />
  );
  return (
    <section className="card flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Joins vs leaves</h2>
          <p className="text-xs text-muted-foreground">Per week (from Monday, UTC), last {WEEKS} weeks</p>
        </div>
        <ul className="flex gap-3 text-xs text-muted-foreground">
          <li className="flex items-center gap-1">
            <span className="size-2 rounded-sm" style={{ backgroundColor: JOINS }} /> Joins
          </li>
          <li className="flex items-center gap-1">
            <span className="size-2 rounded-sm" style={{ backgroundColor: LEAVES }} /> Leaves
          </li>
        </ul>
      </div>
      {max === 0 ? (
        <p className="text-sm text-muted-foreground">No joins or leaves recorded yet.</p>
      ) : (
        <>
          <div className="flex items-end gap-1 h-32" aria-hidden>
            {rows.map((r) => (
              <div
                key={r.week}
                title={`Week of ${shortDate(r.week)}: ${r.joins} joined, ${r.leaves} left`}
                className="flex-1 h-full flex items-end justify-center gap-0.5 rounded hover:bg-foreground/5"
              >
                {bar(r.joins, JOINS)}
                {bar(r.leaves, LEAVES)}
              </div>
            ))}
          </div>
          <div className="flex gap-1 text-xs text-muted-foreground" aria-hidden>
            {rows.map((r, i) => (
              <span key={r.week} className="flex-1 text-center">
                {i % 3 === 0 ? shortDate(r.week) : ""}
              </span>
            ))}
          </div>
          <table className="sr-only">
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
        </>
      )}
    </section>
  );
}

function TopVoice({ rows }: { rows: VoiceRow[] }) {
  return (
    <section className="card flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Top voice members</h2>
        <p className="text-xs text-muted-foreground">Time in voice channels this month (UTC)</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No voice time recorded this month yet.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <li key={row.user_id} className="flex items-center gap-3 text-sm">
              <span className="w-5 text-right text-muted-foreground">{i + 1}</span>
              {row.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.avatar_url} alt="" width={28} height={28} className="rounded-full" />
              ) : (
                <span className="size-7 rounded-full bg-foreground/10" />
              )}
              <span className="flex-1 truncate">{row.display_name}</span>
              <span className="tabular-nums">{formatMinutes(row.voice_minutes)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h.toLocaleString("en-US")} h ${m} min` : `${m} min`;
}
