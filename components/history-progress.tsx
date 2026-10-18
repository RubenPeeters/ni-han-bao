import { historyPercent } from "@/lib/history";
import { createClient } from "@/lib/supabase/server";

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Shown while the bot still counts the server's older messages (#70); gone once it is done. */
export async function HistoryProgress({ guild }: { guild: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("backfill_state")
    .select("channels_total, channels_done, oldest_at, done_at")
    .eq("guild_id", guild)
    .maybeSingle();
  // No row, or a failed read: say nothing rather than block the stats below.
  if (!data || data.done_at) return null;
  return (
    <p role="status" className="text-sm text-muted-foreground">
      Counting history: {historyPercent(data.channels_done, data.channels_total)}%
      {data.oldest_at && <>, back to {day.format(new Date(data.oldest_at))} so far</>}. Older messages are added as
      the bot reads them.
    </p>
  );
}
