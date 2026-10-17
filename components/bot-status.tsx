import { createClient } from "@/lib/supabase/server";
import { cache } from "react";

// The bot writes a heartbeat every minute; older than this means it is down.
const STALE_AFTER_MS = 5 * 60_000;

// The hero, the stat cards and the footer dot render in the same request; query once.
export const loadStatus = cache(async () => {
  const supabase = await createClient();
  // "*", not a column list: a preview can run before the avatar_url migration is applied,
  // and naming a missing column would fail the whole query.
  return supabase.from("bot_status").select("*").maybeSingle();
});

const isOnline = (lastSeen: Date) => Date.now() - lastSeen.getTime() < STALE_AFTER_MS;

const AVATAR_CLASS = "size-24 rounded-full ring-2 ring-primary/40 ring-offset-4 ring-offset-background";

export function AvatarPlaceholder() {
  return <span className={`${AVATAR_CLASS} bg-foreground/10`} aria-hidden />;
}

export async function BotAvatar() {
  const { data } = await loadStatus();
  if (!data?.avatar_url) return <AvatarPlaceholder />;
  return (
    // Discord CDN avatars are already small; next/image would need a remote pattern and
    // optimisation quota for no visible gain.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={data.avatar_url} alt="" width={96} height={96} className={AVATAR_CLASS} />
  );
}

export function StatusPill({ label, color }: { label: string; color: string }) {
  return (
    <p
      role="status"
      className="flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1 text-sm"
    >
      <span className={`size-2 shrink-0 rounded-full ${color}`} aria-hidden />
      {label}
    </p>
  );
}

export async function BotStatusPill() {
  const { data, error } = await loadStatus();
  if (error) return <StatusPill label="Status unknown" color="bg-muted-foreground" />;
  if (!data) return <StatusPill label="Not seen yet" color="bg-muted-foreground" />;
  const lastSeen = new Date(data.last_seen);
  if (isOnline(lastSeen)) return <StatusPill label="Online" color="bg-success" />;
  const since = lastSeen.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  return <StatusPill label={`Offline since ${since} UTC`} color="bg-destructive" />;
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
