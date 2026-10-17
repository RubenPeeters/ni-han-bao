import { createClient } from "@/lib/supabase/server";

const TOP = 10;
const DAY_MS = 24 * 60 * 60_000;
const BUSIEST_DAYS = 30;
// Four whole weeks, so every weekday is counted the same number of times; 30 days would
// give two weekdays an extra day and make them look busier than they are.
const HEATMAP_DAYS = 28;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

interface ChannelRow {
  channel_id: string;
  name: string;
  message_count: number;
}

interface HeatmapCell {
  weekday: number; // 1 = Monday ... 7 = Sunday (ISO, UTC)
  hour: number;
  message_count: number;
}

/** 7 x 24 counts (weekday rows from Monday, hour columns from 00 UTC), zeros filled in. */
function heatmapGrid(cells: HeatmapCell[]): number[][] {
  const grid = WEEKDAYS.map(() => HOURS.map(() => 0));
  for (const c of cells) grid[c.weekday - 1][c.hour] = c.message_count;
  return grid;
}

export async function ChannelStats() {
  const supabase = await createClient();
  const now = Date.now();
  const [busiest, heatmap] = await Promise.all([
    supabase.rpc("busiest_channels", {
      since: new Date(now - BUSIEST_DAYS * DAY_MS).toISOString(),
      top: TOP,
    }),
    supabase.rpc("channel_heatmap", { since: new Date(now - HEATMAP_DAYS * DAY_MS).toISOString() }),
  ]);

  if (busiest.error || heatmap.error) {
    return <p className="text-sm text-destructive">Could not load channel stats.</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      <BusiestChannels rows={busiest.data} />
      <Heatmap grid={heatmapGrid(heatmap.data)} />
    </div>
  );
}

function BusiestChannels({ rows }: { rows: ChannelRow[] }) {
  const max = rows[0]?.message_count ?? 0;
  return (
    <section className="card flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Busiest channels</h2>
        <p className="text-xs text-muted-foreground">Last {BUSIEST_DAYS} days</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No messages counted yet.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <li key={row.channel_id} className="flex items-center gap-3 text-sm">
              <span className="w-5 text-right text-muted-foreground">{i + 1}</span>
              <span className="w-32 truncate">#{row.name}</span>
              <span className="flex-1 h-2 rounded bg-foreground/5">
                <span
                  className="block h-full rounded"
                  style={{
                    width: `${(row.message_count / max) * 100}%`,
                    backgroundColor: "hsl(var(--chart-2))",
                  }}
                />
              </span>
              <span className="tabular-nums">{row.message_count.toLocaleString("en-US")}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Heatmap({ grid }: { grid: number[][] }) {
  const max = Math.max(...grid.flat());
  return (
    <section className="card flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">When people talk</h2>
        <p className="text-xs text-muted-foreground">
          Messages by weekday and hour, UTC, last {HEATMAP_DAYS} days
        </p>
      </div>
      {max === 0 ? (
        <p className="text-sm text-muted-foreground">No messages counted yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-0.5 text-xs text-muted-foreground">
            <thead>
              <tr>
                <th />
                {/* One label per three hours, so labels wider than a cell don't stretch columns. */}
                {HOURS.filter((h) => h % 3 === 0).map((h) => (
                  <th key={h} scope="colgroup" colSpan={3} className="font-normal text-left">
                    {String(h).padStart(2, "0")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((row, d) => (
                <tr key={WEEKDAYS[d]}>
                  <th scope="row" className="font-normal text-left pr-1">
                    {WEEKDAYS[d]}
                  </th>
                  {row.map((count, h) => {
                    const label = `${WEEKDAYS[d]} ${String(h).padStart(2, "0")}:00 UTC: ${count.toLocaleString("en-US")} messages`;
                    return (
                      <td
                        key={h}
                        title={label}
                        className="size-4 rounded-sm bg-foreground/5"
                        style={
                          count
                            ? // Floor of 0.15 so a single message still shows up.
                              { backgroundColor: `hsl(var(--chart-2) / ${0.15 + 0.85 * (count / max)})` }
                            : undefined
                        }
                      >
                        <span className="sr-only">{label}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
