import { countingSince, historyPercent, warmingUp } from "@/lib/history";
import { createClient } from "@/lib/supabase/server";

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Shown on a new server: since when the bot counts (#71) and how far it has read back into
 * older messages (#70). The start date stays after that: it explains a quiet server's empty charts.
 */
export async function CountingStatus({ guild }: { guild: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("backfill_state")
    .select("before_id, channels_total, channels_done, oldest_at, done_at")
    .eq("guild_id", guild)
    .maybeSingle();
  // No row, or a failed read: say nothing rather than block the stats below.
  if (!data) return null;
  const since = countingSince(data.before_id);
  return (
    <div role="status" className="flex flex-col gap-1 text-sm text-muted-foreground">
      <p>
        Counting since {day.format(since)}.
        {warmingUp(since, new Date()) && <> Warming up: member counts and joins fill in over the first week.</>}
      </p>
      {!data.done_at && (
        <p>
          Counting history: {historyPercent(data.channels_done, data.channels_total)}%
          {data.oldest_at && <>, back to {day.format(new Date(data.oldest_at))} so far</>}. Older messages are added
          as the bot reads them.
        </p>
      )}
    </div>
  );
}
