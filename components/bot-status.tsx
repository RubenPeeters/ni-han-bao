import { createClient } from "@/lib/supabase/server";

// The bot writes a heartbeat every minute; older than this means it is down.
const STALE_AFTER_MS = 5 * 60_000;

export async function BotStatus() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bot_status")
    .select("guild_name, member_count, last_seen")
    .maybeSingle();

  if (error) {
    return <p className="text-sm text-red-600">Could not load bot status.</p>;
  }
  if (!data) {
    return <p className="text-sm text-foreground/60">The bot has not checked in yet.</p>;
  }
  const lastSeen = new Date(data.last_seen);
  const online = Date.now() - lastSeen.getTime() < STALE_AFTER_MS;
  return (
    <div className="rounded-lg border p-5 flex flex-col gap-1">
      {!online && (
        <p role="status" className="rounded-md bg-red-600 px-3 py-2 font-semibold text-white">
          Bot offline since {lastSeen.toUTCString()}
        </p>
      )}
      <p className="text-lg font-semibold">{data.guild_name}</p>
      <p className="text-sm">{data.member_count} members</p>
      <p className="text-sm text-foreground/60">
        Bot {online ? "online" : "offline"} · last seen {lastSeen.toUTCString()}
      </p>
    </div>
  );
}
