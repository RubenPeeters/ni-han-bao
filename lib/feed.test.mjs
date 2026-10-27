import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFeed, groupRows, parseFilter, parseShow, toItem } from "./feed.ts";

const row = (kind, happened_at, data, extra = {}) => ({
  kind,
  happened_at,
  guild_id: "g1",
  guild_name: "Demo",
  user_id: "u1",
  user_name: "Mira",
  data,
  ...extra,
});
const deck = (at, version, extra) => row("deck", at, { deck: "d1", name: "Jinx Aggro", version }, extra);

test("saves of one deck by one member on one day become one item", () => {
  const rows = [deck("2026-10-27T09:00:00+00:00", 2), deck("2026-10-27T18:00:00+00:00", 4), deck("2026-10-27T12:00:00+00:00", 3)];
  const [group, ...rest] = groupRows(rows);
  assert.equal(rest.length, 0);
  assert.equal(group.count, 3);
  assert.equal(group.happened_at, "2026-10-27T18:00:00+00:00");
  assert.equal(toItem(group).text, "Mira saved 3 versions of Jinx Aggro");
});

test("another day, deck or member is another item", () => {
  const rows = [
    deck("2026-10-27T09:00:00+00:00", 2),
    deck("2026-10-26T09:00:00+00:00", 1),
    row("deck", "2026-10-27T10:00:00+00:00", { deck: "d2", name: "Ahri", version: 5 }),
    deck("2026-10-27T11:00:00+00:00", 3, { user_id: "u2", user_name: "Sam" }),
  ];
  assert.deepEqual(
    groupRows(rows).map((r) => toItem(r).text),
    ["Sam saved a new version of Jinx Aggro", "Mira saved a new version of Ahri", "Mira saved a new version of Jinx Aggro", "Mira built a new deck, Jinx Aggro"],
  );
});

test("rank changes on one day go from the first rank to the last", () => {
  const change = (at, from, to) => row("rank", at, { queue: "RANKED_SOLO_5x5", from, to });
  const silver = { tier: "SILVER", division: "I", lp: 90 };
  const gold4 = { tier: "GOLD", division: "IV", lp: 0 };
  const gold3 = { tier: "GOLD", division: "III", lp: 12 };
  const [item] = groupRows([change("2026-10-27T20:00:00Z", gold4, gold3), change("2026-10-27T19:00:00Z", silver, gold4)]).map(toItem);
  assert.equal(item.text, "Mira: Silver I · 90 LP → Gold III · 12 LP");
  assert.equal(item.detail, "Solo/Duo");
  assert.equal(item.href, "/s/g1/ranked");
});

test("League week, events, recaps and the catalogue", () => {
  const one = (r) => toItem({ ...r, count: 1 });
  assert.equal(
    one(row("lol_week", "2026-10-27T20:00:00Z", { week: "2026-10-26", this_week: true, games: 14, champion: "Ahri" })).text,
    "Mira: 14 games this week, mostly Ahri",
  );
  assert.equal(
    one(row("lol_week", "2026-10-20T20:00:00Z", { week: "2026-10-19", this_week: false, games: 1, champion: "Lux" })).text,
    "Mira: 1 game the week of Oct 19, mostly Lux",
  );
  const event = { name: "Nexus Night", starts_at: "2026-10-31T13:00:00Z", store: "Spellbound", city: "Ghent", going: ["Ayla", "Jonas", "Mira", "Sam", "Teo"] };
  const soon = one(row("event_soon", "2026-10-30T13:00:00Z", event, { user_id: null, user_name: null }));
  assert.equal(soon.text, "Tomorrow: Nexus Night at Spellbound, Ghent");
  assert.equal(soon.detail, "Sat 31 Oct, 14:00 · Ayla, Jonas, Mira and 2 more going");
  assert.equal(soon.href, "/s/g1/stores");
  assert.equal(one(row("event", "2026-10-20T13:00:00Z", { ...event, name: null, store: null, going: [] })).detail, "Sat 31 Oct, 14:00 · Nobody going yet");
  const recap = one(row("recap", "2026-10-01T08:00:00Z", { month: "2026-09-01" }));
  assert.deepEqual([recap.text, recap.href], ["The September 2026 recap is out", "/s/g1/recap/2026-09"]);
  const cards = one(row("catalogue", "2026-10-01T08:00:00Z", { cards: 12 }, { guild_id: null, guild_name: null }));
  assert.deepEqual([cards.text, cards.guild], ["12 new cards in the catalogue", null]);
});

test("a member's copies added on one day, under Riftbound, linking to their Collection tab", () => {
  const rows = [row("collection", "2026-10-27T20:00:00Z", { day: "2026-10-27", cards: 40 }), row("collection", "2026-10-26T09:00:00Z", { day: "2026-10-26", cards: 1 })];
  const { happening } = buildFeed(rows, "riftbound");
  assert.deepEqual(happening.map((i) => i.text), ["Mira added 40 cards", "Mira added 1 card"]);
  assert.equal(happening[0].href, "/u/u1/collection");
  assert.equal(buildFeed(rows, "league").happening.length, 0);
});

test("For you is kept apart and never filtered; Happening follows the chip", () => {
  const rows = [
    row("confirm", "2026-10-25T10:00:00Z", { cards: 2 }, { guild_id: null, guild_name: null, user_name: null }),
    row("overdue", "2026-10-20T00:00:00Z", { lent: true, due_on: "2026-10-20" }, { guild_id: null, guild_name: null }),
    row("recap", "2026-10-01T08:00:00Z", { month: "2026-09-01" }),
    deck("2026-10-27T09:00:00+00:00", 2),
    row("something_new", "2026-10-27T09:00:00Z", {}),
  ];
  const { forYou, happening } = buildFeed(rows, "riftbound");
  assert.deepEqual(forYou.map((i) => i.text), ["A member lent you 2 cards: did you get them?", "Mira still has your cards, due Oct 20"]);
  assert.deepEqual(happening.map((i) => i.text), ["Mira saved a new version of Jinx Aggro"]);
  assert.equal(buildFeed(rows, "all").happening.length, 2);
  assert.equal(buildFeed(rows, "league").happening.length, 0);
});

test("the chip and page size come from the URL, safely", () => {
  assert.equal(parseFilter("league"), "league");
  assert.equal(parseFilter("nope"), "all");
  assert.equal(parseFilter(undefined), "all");
  assert.equal(parseShow(undefined), 30);
  assert.equal(parseShow("60"), 60);
  assert.equal(parseShow("45"), 60);
  assert.equal(parseShow("-1"), 30);
  assert.equal(parseShow("1e9"), 510);
});
