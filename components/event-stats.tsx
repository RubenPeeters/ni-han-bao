import { EmptyState, ErrorState, StatCard, StatGrid } from "@/components/stat-ui";
import { guildTimeZone } from "@/lib/guild";
import { createClient } from "@/lib/supabase/server";

interface UpcomingEvent {
  id: number;
  name: string | null;
  starts_at: string;
  url: string | null;
  store_name: string | null;
  store_city: string | null;
  going: string[];
}

export async function EventStats({ guild }: { guild: string }) {
  const supabase = await createClient();
  const [timeZone, events] = await Promise.all([
    guildTimeZone(guild),
    // Hidden members are left out of `going` by upcoming_events() and RLS.
    supabase.rpc("upcoming_events", { guild }),
  ]);
  if (events.error) {
    return <ErrorState title="Could not load the events">Try again in a minute.</ErrorState>;
  }
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const rows = events.data as UpcomingEvent[];
  return (
    <StatGrid>
      <StatCard title="Coming up" description="Who is going where; say you are with /event going" wide>
        {rows.length === 0 ? (
          <EmptyState>
            Nothing planned yet. Use /event going in Discord, or click Interested on one of the server&apos;s Discord
            events.
          </EmptyState>
        ) : (
          <ul className="flex flex-col divide-y">
            {rows.map((event) => {
              const title = event.name ?? event.store_name ?? "Event";
              // A Discord event's title leads, so its store goes underneath; otherwise just the city.
              const where = event.name ? event.store_name && `${event.store_name} · ${event.store_city}` : event.store_city;
              return (
                <li key={event.id} className="flex flex-col gap-1 py-2 text-sm first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    {event.url ? (
                      <a
                        href={event.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="min-w-0 truncate font-medium underline-offset-4 hover:text-primary hover:underline"
                      >
                        {title}
                      </a>
                    ) : (
                      <span className="min-w-0 truncate font-medium">{title}</span>
                    )}
                    <time dateTime={event.starts_at} className="shrink-0 tabular-nums text-muted-foreground">
                      {when.format(new Date(event.starts_at))}
                    </time>
                  </div>
                  {where && <span className="truncate text-xs text-muted-foreground">{where}</span>}
                  <p className="text-muted-foreground">
                    {event.going.length ? `Going: ${event.going.join(", ")}` : "Nobody has said they are going yet."}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </StatCard>
    </StatGrid>
  );
}
