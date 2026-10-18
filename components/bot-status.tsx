import { GUILD_ID } from "@/lib/guild";
import { createClient } from "@/lib/supabase/server";
import { cache } from "react";

// The bot writes a heartbeat every minute; older than this means it is down.
const STALE_AFTER_MS = 5 * 60_000;

// The home page card and the footer dot render in the same request; query once.
const loadStatus = cache(async () => {
  const supabase = await createClient();
  return supabase
    .from("bot_status")
    .select("guild_name, member_count, last_seen")
    .eq("guild_id", GUILD_ID)
    .maybeSingle();
});

const isOnline = (lastSeen: Date) => Date.now() - lastSeen.getTime() < STALE_AFTER_MS;

export async function BotStatus() {
  const { data, error } = await loadStatus();

  if (error) {
    return <p className="text-sm text-destructive">Could not load bot status.</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">The bot has not checked in yet.</p>;
  }
  const lastSeen = new Date(data.last_seen);
  const online = isOnline(lastSeen);
  return (
    <div className="card flex flex-col gap-1">
      {!online && (
        <p
          role="status"
          className="mb-2 rounded-md border border-destructive/50 bg-destructive/15 px-3 py-2 font-semibold"
        >
          Bot offline since {lastSeen.toUTCString()}
        </p>
      )}
      <p className="text-2xl font-semibold">{data.guild_name}</p>
      <p className="text-sm">{data.member_count} members</p>
      <p className="text-sm text-muted-foreground">
        Bot {online ? "online" : "offline"} · last seen {lastSeen.toUTCString()}
      </p>
    </div>
  );
}

export async function BotStatusDot() {
  const { data } = await loadStatus();
  const online = data ? isOnline(new Date(data.last_seen)) : null;
  const label = online === null ? "Bot status unknown" : `Bot ${online ? "online" : "offline"}`;
  const color =
    online === null ? "bg-muted-foreground" : online ? "bg-success" : "bg-destructive";
  return (
    <span className="flex items-center gap-2">
      <span className={`size-2 rounded-full ${color}`} aria-hidden />
      {label}
    </span>
  );
}
