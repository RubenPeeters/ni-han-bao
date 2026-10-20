import { describe, expect, it } from "vitest";
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
    expect(out.get("anna")?.map((m) => `${m.card_id}:${m.copies}`)).toEqual(["ahri:1"]);
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
  const match = { guild_id: "g1", trader_id: "bram", card_id: "ahri", copies: 2, ...regulars };

  it("introduces the trader, says where to meet and that no money goes through the bot", () => {
    const text = tradeDm([match], () => "Ahri", () => "UTC", "https://example.com");
    expect(text).toContain("You want **Ahri**: <@bram> has 2 for trade. Meet up: you are both regulars at The Card Corner (Leuven).");
    expect(text).toContain("no prices or payments go through the bot");
    expect(text).toContain("<https://example.com/s/g1/trades>");
    expect(text).not.toMatch(/€|\$|price:/i);
  });

  it("stays within Discord's 2000 characters", () => {
    const text = tradeDm(Array(100).fill(match), () => "A card with a long name", () => "UTC", null);
    expect(text.length).toBeLessThanOrEqual(2000);
  });
});
