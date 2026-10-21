import { type APIActionRowComponent, type APIButtonComponent, type APIContainerComponent, ButtonStyle, ComponentType, MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import type { Card } from "./card-match.js";
import { missingCards } from "./deck-match.js";
import { canSeeDeck, deckMessage, parseCopyButtonId, privatePrompt } from "./decks.js";

describe("missingCards", () => {
  it("pinned entries take their printing first, a copy counts once, languages filter", () => {
    const owned = [
      { card_id: "a", printing_id: "a1", language: "en", quantity: 2 },
      { card_id: "a", printing_id: "a2", language: "fr", quantity: 2 },
      { card_id: "l", printing_id: "l1", language: "en", quantity: 1 },
    ];
    const entries = [
      { section: "main", card_id: "a", printing_id: null, quantity: 3 },
      { section: "sideboard", card_id: "a", printing_id: "a1", quantity: 2 },
      { section: "main", card_id: "b", printing_id: null, quantity: 1 },
    ];
    const deck = { legend_id: "l", language: "en", allow_other_languages: true };
    const any = missingCards(deck, entries, owned);
    expect(any.rows.map((r) => [r.section, r.card_id, r.owned])).toEqual([
      ["legend", "l", 1],
      ["main", "a", 2],
      ["sideboard", "a", 2],
      ["main", "b", 0],
    ]);
    expect(any.missing).toBe(2);
    const english = missingCards({ ...deck, allow_other_languages: false }, entries, owned);
    expect(english.rows.map((r) => r.owned)).toEqual([1, 0, 2, 0]);
    expect(english.missing).toBe(4);
    expect(missingCards({ ...deck, legend_id: null }, [], owned).missing).toBe(0);
  });
});

const card = (id: string, name: string, extra: Partial<Card> = {}): Card => ({
  id, name, type: "Unit", supertypes: [], domains: [], energy: null, might: null, tags: [], rules_text: null, placeholder: false, ...extra,
});

describe("deckMessage", () => {
  const cards = [
    card("l", "Nine-Tailed Fox", { type: "Legend", tags: ["Ahri"], domains: ["Calm", "Mind"] }),
    card("a", "Ahri, Alluring", { supertypes: ["Champion"], domains: ["Mind"], energy: 5 }),
    card("b", "B_ad", { type: "Spell", domains: ["Calm"], energy: 1 }),
    card("c", "Cheap", { domains: ["Calm"], energy: 1 }),
    card("r", "Rune", { type: "Rune" }),
    card("f", "Field", { type: "Battlefield" }),
  ];
  const printing = (card_id: string, image: string | null) => ({
    id: `${card_id}1`, card_id, set_code: "OGN", collector_code: `OGN-${card_id}`, collector_number: 1, rarity: null, illustrator: null, image_url: image,
  });
  const printings = [printing("l", "https://cdn.test/l.png"), printing("a", "https://cdn.test/a.png"), printing("f", "https://cdn.test/f.png")];
  const icons = [{ facet: "domain", label: "Calm", color_primary: "#152311" }];
  const emojis = new Map([["rb_calm", "1"], ["rb_mind", "2"], ["rb_unit", "3"], ["rb_rune", "4"]]);
  const deck = { id: "d1", name: "Foxy", legend_id: "l", champion_id: "a", visibility: "servers", language: "en", allow_other_languages: true };
  const entries = [
    { section: "main", card_id: "b", printing_id: null, quantity: 2 },
    { section: "main", card_id: "a", printing_id: null, quantity: 1 },
    { section: "main", card_id: "a", printing_id: "a1", quantity: 2 },
    { section: "main", card_id: "c", printing_id: null, quantity: 3 },
    { section: "runes", card_id: "r", printing_id: null, quantity: 12 },
    { section: "battlefields", card_id: "f", printing_id: null, quantity: 1 },
  ];
  const texts = (c: unknown): string[] => JSON.stringify(c).match(/"content":"(?:[^"\\]|\\.)*"/g)!.map((m) => JSON.parse(m.slice(10)));

  it("colours by the Legend, pictures its cards, groups by type by energy, and links and copies the deck", () => {
    const { components, flags } = deckMessage(deck, entries, { cards, printings }, icons, emojis, "Anna", 3, "https://site.test/");
    expect(flags).toBe(MessageFlags.IsComponentsV2);
    const [container, row] = components as [APIContainerComponent, APIActionRowComponent<APIButtonComponent>];
    expect(container.accent_color).toBe(0x152311);
    const gallery = container.components.find((c) => c.type === ComponentType.MediaGallery);
    expect(gallery && "items" in gallery && gallery.items.map((i) => i.description)).toEqual(["Nine-Tailed Fox", "Ahri, Alluring", "Field"]);
    const [header, list, footer] = texts(container);
    expect(header).toBe("### Foxy\nShared by Anna · <:rb_calm:1> Calm <:rb_mind:2> Mind\nLegend: Ahri, Nine-Tailed Fox · Chosen Champion: Ahri, Alluring");
    expect(list).toBe(
      [
        "**<:rb_unit:3> Unit** (6)",
        "3× Cheap <:rb_calm:1> · **1**",
        "3× Ahri, Alluring <:rb_mind:2> · **5**",
        "**Spell** (2)",
        "2× B\\_ad <:rb_calm:1> · **1**",
        "**<:rb_rune:4> Runes** (12)",
        "12× Rune",
        "**Battlefields** (1)",
        "1× Field",
      ].join("\n"),
    );
    expect(footer).toBe("-# Anna is missing 3 cards · 1 rules warning: see the deck's page");
    expect(row.components).toEqual([
      { type: ComponentType.Button, style: ButtonStyle.Link, label: "Open deck", url: "https://site.test/decks/d1" },
      { type: ComponentType.Button, style: ButtonStyle.Secondary, label: "Copy as text", custom_id: "deck-copy:d1" },
    ]);
    expect(parseCopyButtonId("deck-copy:d1")).toBe("d1");
    expect(parseCopyButtonId("deck-share:public")).toBeNull();
  });

  it("cuts a long list to Discord's limit with how many more cards, and passes a legal deck", () => {
    const many = Array.from({ length: 120 }, (_, i) => card(`c${i}`, `A card with a long enough name ${String(i).padStart(3, "0")}`, { energy: i % 8 }));
    const champion = card("ch", "Ahri, Alluring", { supertypes: ["Champion"] });
    const legend = card("l", "Nine-Tailed Fox", { type: "Legend", tags: ["Ahri"] });
    const list = [champion, ...many].map((c) => ({ section: "main", card_id: c.id, printing_id: null, quantity: 1 }));
    const { components } = deckMessage(
      { ...deck, champion_id: "ch" },
      list,
      { cards: [legend, champion, ...many], printings: [] },
      [],
      new Map(),
      "Anna",
      0,
      null,
    );
    const all = texts(components[0]);
    expect(all.join("").length).toBeLessThanOrEqual(4000);
    expect(all[1]).toMatch(/\nand \d+ more cards$/);
    expect(all[2]).toBe("-# Anna owns every card · Rules check passed");
    expect(JSON.stringify(components)).not.toContain("MediaGallery");
    expect((components[1] as APIActionRowComponent<APIButtonComponent>).components.map((b) => b.label)).toEqual(["Copy as text"]);
  });

  it("asks about a private deck by its Legend's picture", () => {
    const prompt = privatePrompt("Foxy", cards[0], { printings });
    expect(prompt.components[0]).toMatchObject({ type: ComponentType.Section, accessory: { media: { url: expect.stringContaining("cdn.test/l.png") } } });
    expect(texts(prompt.components[0])).toEqual(["**Foxy** is private, so nobody else could open it. Who may see it?"]);
    expect(privatePrompt("Foxy", null, { printings }).components[0].type).toBe(ComponentType.TextDisplay);
  });
});

describe("canSeeDeck", () => {
  const together = [
    { guild_id: "g1", user_id: "owner" },
    { guild_id: "g1", user_id: "viewer" },
  ];
  it("the owner and a public deck's viewers always, a private deck's never", () => {
    expect(canSeeDeck("owner", "private", "owner", [])).toBe(true);
    expect(canSeeDeck("owner", "public", "viewer", [])).toBe(true);
    expect(canSeeDeck("owner", "private", "viewer", together)).toBe(false);
  });
  it("a servers deck only while they share a server: an old share's button stops after the owner leaves", () => {
    expect(canSeeDeck("owner", "servers", "viewer", together)).toBe(true);
    const left = [{ guild_id: "g2", user_id: "owner" }, { guild_id: "g1", user_id: "viewer" }];
    expect(canSeeDeck("owner", "servers", "viewer", left)).toBe(false);
  });
});
