import {
  EmptyState,
  ErrorState,
  RankList,
  RankRow,
  StatCard,
  StatGrid,
} from "@/components/stat-ui";
import { guildTimeZone } from "@/lib/guild";
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
  weekday: number; // 1 = Monday ... 7 = Sunday (ISO, in the server's time zone)
  hour: number;
  message_count: number;
}

/** 7 x 24 counts (weekday rows from Monday, hour columns from 00 local time), zeros filled in. */
function heatmapGrid(cells: HeatmapCell[]): number[][] {
  const grid = WEEKDAYS.map(() => HOURS.map(() => 0));
  for (const c of cells) grid[c.weekday - 1][c.hour] = c.message_count;
  return grid;
}

export async function ChannelStats({ guild }: { guild: string }) {
  const supabase = await createClient();
  const now = Date.now();
  const timeZone = await guildTimeZone(guild);
  const [busiest, heatmap] = await Promise.all([
    supabase.rpc("busiest_channels", {
      since: new Date(now - BUSIEST_DAYS * DAY_MS).toISOString(),
      top: TOP,
      guild,
    }),
    supabase.rpc("channel_heatmap", {
      since: new Date(now - HEATMAP_DAYS * DAY_MS).toISOString(),
      guild,
      tz: timeZone,
    }),
  ]);

  if (busiest.error || heatmap.error) {
    return <ErrorState title="Could not load channel stats">Try again in a minute.</ErrorState>;
  }
  return (
    <StatGrid>
      <BusiestChannels rows={busiest.data} />
      <Heatmap grid={heatmapGrid(heatmap.data)} timeZone={timeZone} />
    </StatGrid>
  );
}

function BusiestChannels({ rows }: { rows: ChannelRow[] }) {
  const max = rows[0]?.message_count ?? 0;
  return (
    <StatCard title="Busiest channels" description={`Messages, last ${BUSIEST_DAYS} days`} wide>
      {rows.length === 0 ? (
        <EmptyState>The busiest channels appear here once people send messages.</EmptyState>
      ) : (
        <RankList>
          {rows.map((row, i) => (
            <RankRow key={row.channel_id} rank={i + 1} value={row.message_count.toLocaleString("en-US")}>
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="truncate">#{row.name}</span>
                <span className="h-1.5 rounded-full bg-muted" aria-hidden>
                  <span
                    className="block h-full rounded-full bg-chart-2"
                    style={{ width: `${(row.message_count / max) * 100}%` }}
                  />
                </span>
              </span>
            </RankRow>
          ))}
        </RankList>
      )}
    </StatCard>
  );
}

// Floor of 0.15 so a single message still shows up.
const heat = (count: number, max: number) =>
  count ? { backgroundColor: `hsl(var(--chart-2) / ${0.15 + 0.85 * (count / max)})` } : undefined;

export function Heatmap({ grid, timeZone }: { grid: number[][]; timeZone: string }) {
  const max = Math.max(...grid.flat());
  return (
    <StatCard
      title="When people talk"
      description={`Messages by weekday and hour, ${timeZone} time, last ${HEATMAP_DAYS} days`}
      wide
      aside={
        max > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground" aria-hidden>
            Less
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <span key={f} className="size-3 rounded-[3px] bg-muted" style={heat(f * max, max)} />
            ))}
            More
          </div>
        )
      }
    >
      {max === 0 ? (
        <EmptyState>The busiest hours of the week appear here once people send messages.</EmptyState>
      ) : (
        // Fixed layout with fluid cells: 24 columns fit a 375px screen without scrolling.
        <table className="w-full table-fixed border-separate border-spacing-0.5 text-xs text-muted-foreground">
          <caption className="sr-only">Messages per weekday and hour ({timeZone} time)</caption>
          <colgroup>
            <col className="w-9" />
          </colgroup>
          <thead>
            <tr>
              <th />
              {/* One label per three hours, so labels wider than a cell don't stretch columns. */}
              {HOURS.filter((h) => h % 3 === 0).map((h) => (
                <th key={h} scope="colgroup" colSpan={3} className="text-left font-normal tabular-nums">
                  {String(h).padStart(2, "0")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, d) => (
              <tr key={WEEKDAYS[d]}>
                <th scope="row" className="pr-1 text-left font-normal">
                  {WEEKDAYS[d]}
                </th>
                {row.map((count, h) => {
                  const label = `${WEEKDAYS[d]} ${String(h).padStart(2, "0")}:00 ${timeZone}: ${count.toLocaleString("en-US")} messages`;
                  return (
                    <td key={h} title={label} className="p-0">
                      <span className="block aspect-square rounded-[3px] bg-muted" style={heat(count, max)} />
                      <span className="sr-only">{label}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </StatCard>
  );
}
