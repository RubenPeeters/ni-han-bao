import { describe, expect, it } from "vitest";
import { canRemove, newStore, storeChoices, storeList, type Store } from "./stores.js";

const store = (id: number, name: string, city: string, extra: Partial<Store> = {}): Store => ({
  id,
  game: "Riftbound",
  name,
  city,
  url: null,
  added_by: "u1",
  ...extra,
});

describe("newStore", () => {
  it("trims and defaults the game to Riftbound", () => {
    expect(newStore({ name: " Shop ", city: " Gent ", link: null, game: " " })).toEqual({
      game: "Riftbound",
      name: "Shop",
      city: "Gent",
      url: null,
    });
  });

  it("keeps an https link and another game", () => {
    expect(newStore({ name: "Shop", city: "Gent", link: "https://playriftbound.com/x", game: "Lorcana" })).toMatchObject({
      game: "Lorcana",
      url: "https://playriftbound.com/x",
    });
  });

  it.each(["javascript:alert(1)", "http://shop.be", "not a url"])("refuses the link %s", (link) => {
    expect(newStore({ name: "Shop", city: "Gent", link, game: null })).toMatch(/https/);
  });

  it("refuses a blank name or city", () => {
    expect(typeof newStore({ name: " ", city: "Gent", link: null, game: null })).toBe("string");
    expect(typeof newStore({ name: "Shop", city: "", link: null, game: null })).toBe("string");
  });
});

describe("canRemove", () => {
  it("lets the adder or Manage Server remove, nobody else", () => {
    expect(canRemove({ added_by: "u1" }, "u1", false)).toBe(true);
    expect(canRemove({ added_by: "u1" }, "u2", true)).toBe(true);
    expect(canRemove({ added_by: "u1" }, "u2", false)).toBe(false);
    // A forgotten adder leaves it to Manage Server.
    expect(canRemove({ added_by: null }, "u2", false)).toBe(false);
  });
});

describe("storeChoices", () => {
  it("matches name, city or game and caps at 25", () => {
    const stores = [store(1, "Dragon's Lair", "Gent"), store(2, "Card Corner", "Antwerpen", { game: "Lorcana" })];
    expect(storeChoices(stores, "gent")).toEqual([{ name: "Dragon's Lair (Gent)", value: 1 }]);
    expect(storeChoices(stores, "lorcana")).toEqual([{ name: "Card Corner (Antwerpen, Lorcana)", value: 2 }]);
    expect(storeChoices(Array.from({ length: 30 }, (_, i) => store(i, `S${i}`, "C")), "")).toHaveLength(25);
  });
});

describe("storeList", () => {
  it("says how to add the first store", () => {
    expect(storeList([], "https://x", "g")).toMatch(/\/store add/);
  });

  it("lists stores with unfurl-free links and escaped names", () => {
    const text = storeList([store(1, "*Bold*", "Gent", { url: "https://a.be" })], "https://site", "g");
    expect(text).toContain("<https://site/s/g/stores>");
    expect(text).toContain("- **\\*Bold\\* \\(Gent\\)** <https://a.be>");
  });

  it("stays under Discord's 2000 characters", () => {
    const many = Array.from({ length: 100 }, (_, i) => store(i, `Store number ${i}`, "Somewhere"));
    expect(storeList(many, null, "g").length).toBeLessThanOrEqual(2000);
  });
});
