import { type APIActionRowComponent, type APIButtonComponent, ApplicationCommandOptionType, ButtonStyle, ComponentType } from "discord.js";
import { escapeMarkdown, storeLabel, type Store } from "./stores.js";
import { fromWallClock } from "./zone.js";

export const EVENT_COMMAND = {
  name: "event",
  description: "Say which events you are going to, so others can meet you there",
  options: [
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "going",
      description: "Mark yourself as going: give the event's link, or its store and time",
      options: [
        { type: ApplicationCommandOptionType.String, name: "link", description: "Its PlayRiftbound or Discord event link", max_length: 300 },
        {
          type: ApplicationCommandOptionType.Integer,
          name: "store",
          description: "Where it is (start typing its name or city)",
          autocomplete: true,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: "when",
          description: "Date and time in the server's time zone, like 2026-10-25 19:00",
          max_length: 20,
        },
      ],
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "not-going",
      description: "Undo /event going",
      options: [
        {
          type: ApplicationCommandOptionType.Integer,
          name: "event",
          description: "Start typing its store or date",
          required: true,
          autocomplete: true,
        },
      ],
    },
  ],
} as const;

export const GOING_PREFIX = "event-going:";

/** The Going button's custom id for an event, and back. */
export const goingId = (eventId: number) => `${GOING_PREFIX}${eventId}`;
export function goingEventId(customId: string): number | null {
  if (!customId.startsWith(GOING_PREFIX)) return null;
  const id = Number(customId.slice(GOING_PREFIX.length));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The UTC instant of "YYYY-MM-DD HH:MM" in `timeZone`, or why it is not a future time. Typed by members, so untrusted. */
export function parseWhen(text: string, timeZone: string, now: Date): Date | string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(text.trim());
  const usage = "Give the date and time like 2026-10-25 19:00.";
  if (!m) return usage;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const back = new Date(wall);
  // Date.UTC rolls over (Feb 30 is Mar 2), so a changed field means it was not a real date.
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day || hour > 23 || minute > 59) return usage;
  const at = new Date(fromWallClock(wall, timeZone));
  if (at.getTime() < now.getTime()) return "That time has already passed.";
  return at;
}

/** The store a Discord event is at: the longest store name found in its location text. */
export function matchStore<S extends Pick<Store, "id" | "name">>(stores: S[], location: string | null): S | null {
  const text = location?.toLowerCase() ?? "";
  if (!text) return null;
  return (
    stores
      .filter((s) => text.includes(s.name.toLowerCase()))
      .sort((a, b) => b.name.length - a.name.length)[0] ?? null
  );
}

export const SUBSCRIBER_PAGE = 100;

/** Every Interested member of a Discord event, by user id, a page of 100 at a time (Discord's maximum). */
export async function allSubscriberIds(page: (after: string) => Promise<string[]>): Promise<string[]> {
  const ids: string[] = [];
  // With `after`, Discord sorts by user id ascending, so the last id is where the next page starts.
  for (let after = "0"; ; ) {
    const batch = await page(after);
    ids.push(...batch);
    if (batch.length < SUBSCRIBER_PAGE) return ids;
    after = batch[batch.length - 1];
  }
}

/** The Interested attendees recorded for an event who are no longer Interested on Discord. */
export const unticked = (recorded: string[], interested: string[]) => {
  const now = new Set(interested);
  return recorded.filter((id) => !now.has(id));
};

/** What upcoming_events() returns; hidden members are already left out of `going`. */
export interface UpcomingEvent {
  id: number;
  name: string | null;
  starts_at: string;
  url: string | null;
  store_name: string | null;
  store_city: string | null;
  going: string[];
}

const formats = new Map<string, Intl.DateTimeFormat>();

/** Like "Sat 25 Oct, 19:00", in the server's time zone. */
export function eventTime(at: string | Date, timeZone: string): string {
  let f = formats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formats.set(timeZone, f);
  }
  return f.format(new Date(at));
}

/** "Sat 25 Oct, 19:00 · Title · Store (City)", leaving out what the event does not have. */
export function eventLabel(event: Pick<UpcomingEvent, "name" | "starts_at" | "store_name" | "store_city">, timeZone: string) {
  const store = event.store_name ? `${event.store_name} (${event.store_city})` : null;
  return [eventTime(event.starts_at, timeZone), event.name, store].filter(Boolean).join(" · ");
}

/** Autocomplete choices for /event not-going, at most 25 (Discord's limit). */
export function eventChoices(events: UpcomingEvent[], typed: string, timeZone: string) {
  const query = typed.trim().toLowerCase();
  return events
    .map((e) => ({ name: eventLabel(e, timeZone).slice(0, 100), value: e.id }))
    .filter((c) => !query || c.name.toLowerCase().includes(query))
    .slice(0, 25);
}

/** The public reply to /event going; names nobody, so a hidden member's going stays off the list. */
export function goingText(store: Pick<Store, "game" | "name" | "city"> | null, at: string, timeZone: string, url: string | null) {
  const where = store ? ` at ${escapeMarkdown(storeLabel(store))}` : "";
  const link = url ? ` <${url}>` : "";
  return `Someone is going${where} on ${eventTime(at, timeZone)}.${link}\nComing too? Click Going.`;
}

/** The public message after /event going, with the button that lets others join. */
export function goingMessage(eventId: number, store: Pick<Store, "game" | "name" | "city"> | null, at: string, timeZone: string, url: string | null) {
  const row: APIActionRowComponent<APIButtonComponent> = {
    type: ComponentType.ActionRow,
    components: [{ type: ComponentType.Button, custom_id: goingId(eventId), label: "Going", style: ButtonStyle.Primary }],
  };
  return { content: goingText(store, at, timeZone, url), components: [row] };
}

/** The weekly report's field: the coming week's events with who is going. */
export function eventsField(events: UpcomingEvent[], timeZone: string): string {
  if (events.length === 0) return "Nothing planned. Say where you're playing with /event going.";
  const lines = events.map((e) => {
    const who = e.going.length ? e.going.map(escapeMarkdown).join(", ") : "nobody yet";
    return `**${escapeMarkdown(eventLabel(e, timeZone))}**: ${who}`;
  });
  const text = lines.join("\n");
  // shortcut: cut at Discord's 1024 characters per field; the site lists them all.
  return text.length <= 1024 ? text : `${text.slice(0, 1021)}...`;
}
