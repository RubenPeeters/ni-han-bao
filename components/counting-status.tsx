import { countingSince, historyPercent, warmingUp } from "@/lib/history";
import { createClient } from "@/lib/supabase/server";

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Shown on a new server: since when the bot counts (#71) and how far it has read back into
 * older messages (#70). Gone once the first week is over and the history is done.
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
  const warming = warmingUp(since, new Date());
  if (!warming && data.done_at) return null;
  return (
    <div role="status" className="flex flex-col gap-1 text-sm text-muted-foreground">
      {warming && (
        <p>
          Warming up: counting since {dayMonth.format(since)}. Member counts and joins fill in over the first week.
        </p>
      )}
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
