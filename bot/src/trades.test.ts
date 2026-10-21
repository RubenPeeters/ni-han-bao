import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Catalogue } from "./card-match.js";
import { newMatches, placeText, tradeDm, type Candidate, type Place } from "./trades.js";
import type { Wanted } from "./wishlist.js";

const nowhere: Place = { place_kind: null, event_name: null, starts_at: null, store_name: null, store_city: null };
const regulars: Place = { ...nowhere, place_kind: "regulars", store_name: "The Card Corner", store_city: "Leuven" };
const candidate = (c: Partial<Candidate>): Candidate => ({
  guild_id: "g1",
  user_id: "anna",
  trader_id: "bram",
  card_id: "ahri",
  printing_id: "P1",
  language: "en",
  copies: 1,
  ...nowhere,
  ...c,
});
const want = (w: Partial<Wanted>): Wanted => ({ card_id: "ahri", printing_id: null, language: null, decks: 0, manual: 1, wanted: 1, ...w });

describe("newMatches", () => {
  it("matches only what is still wanted, in a printing and language that fits", () => {
    const wanted = [want({ printing_id: "P1" }), want({ card_id: "annie", wanted: 0 }), want({ card_id: "jinx", language: "fr" })];
    const out = newMatches(
      [
        candidate({}),
        candidate({ printing_id: "P2" }),
        candidate({ card_id: "annie" }),
        candidate({ card_id: "jinx", language: "en" }),
        candidate({ card_id: "teemo" }),
      ],
      () => wanted,
    );
    expect(out.get("anna")?.map((m) => `${m.card_id}:${m.copies}:${m.wanted}`)).toEqual(["ahri:1:1"]);
  });

  it("adds up a trader's fitting copies and keeps the server with the best place to meet", () => {
    const out = newMatches(
      [
        candidate({ copies: 2 }),
        candidate({ language: "fr" }),
        candidate({ guild_id: "g2", copies: 2, ...regulars }),
        candidate({ guild_id: "g2", language: "fr", ...regulars }),
        candidate({ trader_id: "chloe" }),
      ],
      () => [want({})],
    );
    expect(out.get("anna")?.map((m) => `${m.trader_id}:${m.guild_id}:${m.copies}`)).toEqual(["bram:g2:3", "chloe:g1:1"]);
  });

  it("asks for each wanter's wishlist once", () => {
    let asked = 0;
    newMatches([candidate({}), candidate({ trader_id: "chloe" })], () => (asked++, [want({})]));
    expect(asked).toBe(1);
  });
});

describe("placeText", () => {
  it("names an event, a store and a city, never more", () => {
    const event = { ...regulars, place_kind: "event" as const, event_name: "Nexus Night", starts_at: "2026-10-24T17:00:00Z" };
    expect(placeText(event, "Europe/Brussels")).toBe("you are both going to Sat 24 Oct, 19:00 · Nexus Night · The Card Corner (Leuven)");
    expect(placeText(regulars, "UTC")).toBe("you are both regulars at The Card Corner (Leuven)");
    expect(placeText({ ...regulars, place_kind: "city" }, "UTC")).toBe("the nearest store is The Card Corner (Leuven)");
    expect(placeText(nowhere, "UTC")).toBeNull();
  });
});

describe("tradeDm", () => {
  const catalogue = JSON.parse(readFileSync(new URL("../riftbound-cards.json", import.meta.url), "utf8")) as Catalogue;
  const match = { guild_id: "g1", trader_id: "bram", card_id: "ahri-alluring", copies: 2, wanted: 3, ...regulars };

  it("pictures the card, introduces the trader, says where to meet and that no money goes through the bot", () => {
    const text = JSON.stringify(tradeDm([match], catalogue, new Map(), () => "UTC", "https://example.com"));
    expect(text).toContain("**Ahri, Alluring** Calm\\nYou want 3, <@bram> has 2 for trade.\\nMeet up: you are both regulars at The Card Corner (Leuven).");
    expect(text.match(/"type":11/g)).toHaveLength(1);
    expect(text).toContain("no prices or payments go through the bot");
    expect(text).toContain("<https://example.com/s/g1/trades>");
    expect(text).not.toMatch(/€|\$|price:/i);
  });

  it("shows the first five matches and sends the rest to the Trades page", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...match, trader_id: `t${i}` }));
    const text = JSON.stringify(tradeDm(many, catalogue, new Map(), () => "UTC", "https://example.com"));
    expect(text.match(/You want/g)).toHaveLength(5);
    expect(text).toContain("And 3 more on the Trades page: <https://example.com/s/g1/trades>");
  });
});
