import { createClient } from "@/lib/supabase/server";

const TOP = 10;

interface Row {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  message_count: number;
}

/** Monday 00:00 UTC of the week containing `now`, as YYYY-MM-DD. */
function utcWeekStart(now: Date): string {
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday),
  );
  return monday.toISOString().slice(0, 10);
}

export async function Leaderboard() {
  const supabase = await createClient();
  const weekStart = utcWeekStart(new Date());
  const [week, allTime] = await Promise.all([
    supabase.rpc("leaderboard", { since: weekStart, top: TOP }),
    supabase.rpc("leaderboard", { top: TOP }),
  ]);

  if (week.error || allTime.error) {
    return <p className="text-sm text-red-600">Could not load the leaderboard.</p>;
  }
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <Board title="This week" subtitle={`Since Monday ${weekStart} (UTC)`} rows={week.data} />
      <Board title="All time" rows={allTime.data} />
    </div>
  );
}

function Board({ title, subtitle, rows }: { title: string; subtitle?: string; rows: Row[] }) {
  return (
    <section className="rounded-lg border p-5 flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-foreground/60">{subtitle}</p>}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-foreground/60">No messages counted yet.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <li key={row.user_id} className="flex items-center gap-3 text-sm">
              <span className="w-5 text-right text-foreground/60">{i + 1}</span>
              {row.avatar_url ? (
                // Discord CDN avatars are already small; next/image would need a remote
                // pattern and optimisation quota for no visible gain.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.avatar_url} alt="" width={28} height={28} className="rounded-full" />
              ) : (
                <span className="size-7 rounded-full bg-foreground/10" />
              )}
              <span className="flex-1 truncate">{row.display_name}</span>
              <span className="tabular-nums">{row.message_count.toLocaleString("en-US")}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
