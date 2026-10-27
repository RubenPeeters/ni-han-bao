/** One row of home_feed(): a fact as the database has it, before grouping. */
export interface FeedRow {
  kind: string;
  happened_at: string;
  guild_id: string | null;
  guild_name: string | null;
  user_id: string | null;
  user_name: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
}

export type Filter = "all" | "riftbound" | "league" | "server";

export const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "riftbound", label: "Riftbound" },
  { value: "league", label: "League" },
  { value: "server", label: "Server" },
];

export const PAGE = 30;

export interface FeedItem {
  key: string;
  at: string;
  guild: { id: string; name: string } | null;
  text: string;
  detail: string | null;
  href: string;
}

const FOR_YOU = new Set(["request", "confirm", "overdue", "trade"]);
const FILTER_OF: Record<string, Filter> = {
  event: "riftbound",
  event_soon: "riftbound",
  deck: "riftbound",
  deck_shared: "riftbound",
  catalogue: "riftbound",
  collection: "riftbound",
  rank: "league",
  lol_week: "league",
  recap: "server",
};

export const parseFilter = (value: unknown): Filter =>
  FILTERS.some((f) => f.value === value) ? (value as Filter) : "all";

/** ?show=: how many Happening items, in whole pages; home_feed() returns 500 rows of the filter at most. */
export function parseShow(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n > PAGE ? Math.min(Math.ceil(n / PAGE), 17) * PAGE : PAGE;
}

/**
 * Repeats of one thing by one member on one day become one row: deck versions per deck, rank
 * changes per queue. The group keeps its latest time, the first rank it came from and a count.
 */
// shortcut: days are UTC days, so a late-night streak can split in two; group in the server's time zone if that shows.
export function groupRows(rows: FeedRow[]): (FeedRow & { count: number })[] {
  const groups = new Map<string, FeedRow & { count: number }>();
  const sorted = [...rows].sort((a, b) => Date.parse(a.happened_at) - Date.parse(b.happened_at));
  sorted.forEach((row, i) => {
    const what = row.kind === "deck" ? row.data.deck : row.kind === "rank" ? row.data.queue : null;
    const key = what == null ? `${i}` : [row.kind, row.user_id, what, row.happened_at.slice(0, 10)].join("|");
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { ...row, count: 1 });
      return;
    }
    group.count++;
    group.happened_at = row.happened_at;
    group.data = {
      ...row.data,
      ...(row.kind === "rank" && { from: group.data.from }),
      ...(row.kind === "deck" && { version: Math.min(group.data.version, row.data.version) }),
    };
  });
  return [...groups.values()].sort((a, b) => Date.parse(b.happened_at) - Date.parse(a.happened_at));
}

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${n === 1 ? word : `${word}s`}`;

const day = (date: string) =>
  new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// The site's server is in Belgium, as formatExact() in lib/time.ts.
const when = (date: string) =>
  new Date(date).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });

const month = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

const QUEUES: Record<string, string> = { RANKED_SOLO_5x5: "Solo/Duo", RANKED_FLEX_SR: "Flex" };

// As rankText() in components/lol-ranks.tsx: Riot's own tier, division and LP.
const rank = (r: { tier: string; division: string | null; lp: number }) =>
  `${r.tier.charAt(0)}${r.tier.slice(1).toLowerCase()}${r.division ? ` ${r.division}` : ""} · ${r.lp} LP`;

function going(names: string[]): string {
  if (names.length === 0) return "Nobody going yet";
  const shown = names.length > 3 ? [...names.slice(0, 3), `${names.length - 3} more`] : names;
  return `${shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown[0]} going`;
}

/** The text and link of one grouped row. */
export function toItem(row: FeedRow & { count: number }): FeedItem {
  const who = row.user_name ?? "A member";
  const d = row.data;
  const g = row.guild_id;
  const item = (text: string, href: string, detail: string | null = null): FeedItem => ({
    key: [row.kind, g, row.user_id, d.deck ?? d.queue ?? d.starts_at ?? d.month ?? d.week ?? d.day ?? "", row.happened_at].join("|"),
    at: row.happened_at,
    guild: g && row.guild_name ? { id: g, name: row.guild_name } : null,
    text,
    detail,
    href,
  });
  switch (row.kind) {
    case "request":
      return item(`${who} asks to borrow ${plural(d.cards ?? 0, "card")}`, "/loans");
    case "confirm":
      return item(`${who} lent you ${plural(d.cards ?? 0, "card")}: did you get them?`, "/loans");
    case "overdue":
      return item(
        d.lent ? `${who} still has your cards, due ${day(d.due_on)}` : `Your loan from ${who} was due ${day(d.due_on)}`,
        "/loans",
      );
    case "trade":
      return item(`${who} has ${plural(d.cards, "card")} from your wishlist for trade`, `/s/${g}/trades`);
    case "event":
    case "event_soon": {
      const title = `${row.kind === "event_soon" ? "Tomorrow: " : ""}${d.name ?? "An event"}`;
      const place = d.store ? ` at ${d.store}${d.city ? `, ${d.city}` : ""}` : "";
      return item(`${title}${place}`, `/s/${g}/stores`, `${when(d.starts_at)} · ${going(d.going ?? [])}`);
    }
    case "deck":
      return item(
        d.version === 1
          ? `${who} built a new deck, ${d.name}`
          : row.count > 1
            ? `${who} saved ${row.count} versions of ${d.name}`
            : `${who} saved a new version of ${d.name}`,
        `/decks/${d.deck}`,
      );
    case "deck_shared":
      return item(`${who} shared a deck, ${d.name}`, `/decks/${d.deck}`);
    case "collection":
      return item(`${who} added ${plural(d.cards, "card")}`, `/u/${row.user_id}/collection`);
    case "catalogue":
      return item(`${plural(d.cards, "new card")} in the catalogue`, "/cards");
    case "recap":
      return item(`The ${month(d.month)} recap is out`, `/s/${g}/recap/${String(d.month).slice(0, 7)}`);
    case "rank":
      return item(`${who}: ${rank(d.from)} → ${rank(d.to)}`, `/s/${g}/ranked`, QUEUES[d.queue] ?? null);
    case "lol_week":
      return item(
        `${who}: ${plural(d.games, "game")} ${d.this_week ? "this week" : `the week of ${day(d.week)}`}, mostly ${d.champion}`,
        `/s/${g}/ranked`,
      );
    default:
      throw new Error(`unknown feed item ${row.kind}`);
  }
}

/** For you (the visitor's own, never filtered) and Happening (filtered, newest first). */
export function buildFeed(rows: FeedRow[], filter: Filter) {
  const known = rows.filter((r) => FOR_YOU.has(r.kind) || r.kind in FILTER_OF);
  return {
    forYou: groupRows(known.filter((r) => FOR_YOU.has(r.kind))).map(toItem),
    happening: groupRows(
      known.filter((r) => !FOR_YOU.has(r.kind) && (filter === "all" || FILTER_OF[r.kind] === filter)),
    ).map(toItem),
  };
}
