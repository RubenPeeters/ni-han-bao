import { utcWeekStart } from "@/components/leaderboard";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { Bot } from "lucide-react";
import { cache, type ReactNode } from "react";
import { RelativeTime } from "./relative-time";

// The bot writes a heartbeat every minute; older than this means it is down.
const STALE_AFTER_MS = 5 * 60_000;

export interface Totals {
  servers: number;
  members: number;
  messages_since: number;
  active_since: number;
  bot_last_seen: string | null;
  bot_avatar_url: string | null;
}

// The hero, the home stats and the footer dot render in the same request; query once.
// public_totals(): the logged-out page must keep working once part 5 closes the tables to anon.
export const loadStatus = cache(async () => {
  const supabase = await createClient();
  return supabase
    .rpc("public_totals", { since: utcWeekStart(new Date()) })
    .single<Totals>();
});

const isOnline = (lastSeen: Date) => Date.now() - lastSeen.getTime() < STALE_AFTER_MS;

export function BotAvatar({ url }: { url: string | null }) {
  const ring = "size-24 shrink-0 rounded-full bg-muted ring-4 ring-primary/30 sm:size-28";
  if (!url) {
    return (
      <span aria-hidden className={cn(ring, "flex items-center justify-center text-muted-foreground")}>
        <Bot className="size-10" />
      </span>
    );
  }
  // Discord CDN avatars are already sized by the URL; next/image would need a remote
  // pattern and optimisation quota for no visible gain.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" width={112} height={112} className={cn(ring, "object-cover")} />;
}

export async function HeroAvatar() {
  const { data } = await loadStatus();
  return <BotAvatar url={data?.bot_avatar_url ?? null} />;
}

export function StatusPill({ tone, children }: { tone: "online" | "offline" | "unknown"; children: ReactNode }) {
  return (
    <p
      role="status"
      className={cn(
        "inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-sm",
        tone === "online" && "border-success/40 bg-success/10",
        tone === "offline" && "border-destructive/50 bg-destructive/10",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          tone === "online" ? "bg-success" : tone === "offline" ? "bg-destructive" : "bg-muted-foreground",
        )}
      />
      {children}
    </p>
  );
}

export async function HeroStatus() {
  const { data, error } = await loadStatus();
  if (error) return <StatusPill tone="unknown">Status unavailable</StatusPill>;
  if (!data?.bot_last_seen) return <StatusPill tone="unknown">Not seen yet</StatusPill>;
  const lastSeen = new Date(data.bot_last_seen);
  return isOnline(lastSeen) ? (
    <StatusPill tone="online">Online</StatusPill>
  ) : (
    <StatusPill tone="offline">
      <span>
        Offline, last seen <RelativeTime date={lastSeen} />
      </span>
    </StatusPill>
  );
}

export async function BotStatusDot() {
  const { data } = await loadStatus();
  const online = data?.bot_last_seen ? isOnline(new Date(data.bot_last_seen)) : null;
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
