import { type APIActionRowComponent, type APIButtonComponent, type APIContainerComponent, ButtonStyle, ComponentType, MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import type { Card } from "./card-match.js";
import { missingCards } from "./deck-match.js";
import { canSeeDeck, curveBars, deckMessage, parseCopyButtonId, privatePrompt } from "./decks.js";

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
    const deck = { legend_id: "l", legend_printing_id: null, language: "en", allow_other_languages: true };
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
    // A pinned Legend takes only its printing.
    expect(missingCards({ ...deck, legend_printing_id: "l2" }, [], owned).rows).toEqual([
      { section: "legend", card_id: "l", printing_id: "l2", quantity: 1, owned: 0 },
    ]);
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
  const deck = { id: "d1", name: "Foxy", legend_id: "l", legend_printing_id: null, champion_id: "a", champion_printing_id: null, visibility: "servers", language: "en", allow_other_languages: true };
  const entries = [
    { section: "main", card_id: "b", printing_id: null, quantity: 2 },
    { section: "main", card_id: "a", printing_id: null, quantity: 1 },
    { section: "main", card_id: "a", printing_id: "a1", quantity: 2 },
    { section: "main", card_id: "c", printing_id: null, quantity: 3 },
    { section: "runes", card_id: "r", printing_id: null, quantity: 12 },
    { section: "battlefields", card_id: "f", printing_id: null, quantity: 1 },
  ];
  const texts = (c: unknown): string[] => JSON.stringify(c).match(/"content":"(?:[^"\\]|\\.)*"/g)!.map((m) => JSON.parse(m.slice(10)));

  it("colours by the Legend, pictures its Legend and Chosen Champion, draws the curve, and links and copies the deck", () => {
    const { components, flags } = deckMessage(deck, entries, { cards, printings }, icons, emojis, "Anna", "https://site.test/");
    expect(flags).toBe(MessageFlags.IsComponentsV2);
    const [container, row] = components as [APIContainerComponent, APIActionRowComponent<APIButtonComponent>];
    expect(container.accent_color).toBe(0x152311);
    const gallery = container.components.find((c) => c.type === ComponentType.MediaGallery);
    expect(gallery && "items" in gallery && gallery.items.map((i) => i.description)).toEqual(["Nine-Tailed Fox", "Ahri, Alluring"]);
    const [header, curve, footer] = texts(container);
    expect(header).toBe("### Foxy\nShared by Anna · <:rb_calm:1> Calm <:rb_mind:2> Mind\nLegend: Ahri, Nine-Tailed Fox · Chosen Champion: Ahri, Alluring");
    expect(curve).toBe(`**Energy curve**\n\`\`\`\n${curveBars([0, 5, 0, 0, 0, 3, 0, 0].map((count, i) => ({ energy: i === 7 ? "7+" : String(i), count })))}\n\`\`\``);
    expect(curve).not.toContain("Cheap");
    expect(footer).toBe("-# 8 cards in the main deck");
    expect(row.components).toEqual([
      { type: ComponentType.Button, style: ButtonStyle.Link, label: "Open deck", url: "https://site.test/decks/d1" },
      { type: ComponentType.Button, style: ButtonStyle.Secondary, label: "Copy as text", custom_id: "deck-copy:d1" },
    ]);
    expect(parseCopyButtonId("deck-copy:d1")).toBe("d1");
    expect(parseCopyButtonId("deck-share:public")).toBeNull();
  });

  it("shows a pinned Legend's printing, its picture and collector code", () => {
    const alt = { ...printing("l", "https://cdn.test/l-alt.png"), id: "l2", collector_code: "OGN-l*", collector_number: 2 };
    const { components } = deckMessage({ ...deck, legend_printing_id: "l2" }, entries, { cards, printings: [...printings, alt] }, icons, emojis, "Anna", null);
    expect(texts(components[0])[0]).toContain("Legend: Ahri, Nine-Tailed Fox (OGN-l\\*)");
    expect(JSON.stringify(components)).toContain("cdn.test/l-alt.png");
    expect(JSON.stringify(components)).not.toContain("cdn.test/l.png");
    const prompt = privatePrompt("Foxy", cards[0], { printings: [...printings, alt] }, "l2");
    expect(prompt.components[0]).toMatchObject({ accessory: { media: { url: expect.stringContaining("cdn.test/l-alt.png") } } });
  });

  it("pictures a pinned Chosen Champion's printing, its copy still counted in the main deck", () => {
    const alt = { ...printing("a", "https://cdn.test/a-alt.png"), id: "a2", collector_number: 2 };
    const { components } = deckMessage({ ...deck, champion_printing_id: "a2" }, entries, { cards, printings: [...printings, alt] }, icons, emojis, "Anna", null);
    expect(JSON.stringify(components)).toContain("cdn.test/a-alt.png");
    expect(JSON.stringify(components)).not.toContain("cdn.test/a.png");
    expect(texts(components[0]).at(-1)).toBe("-# 8 cards in the main deck");
  });

  it("an empty deck: no pictures, no curve, no Open deck without a site", () => {
    const { components } = deckMessage({ ...deck, legend_id: null, champion_id: null }, [], { cards, printings }, icons, emojis, "Anna", null);
    expect(JSON.stringify(components)).not.toContain(`"type":${ComponentType.MediaGallery}`);
    expect(texts(components[0])).toEqual(["### Foxy\nShared by Anna\nLegend: none yet · Chosen Champion: none yet", "-# 0 cards in the main deck"]);
    expect((components[1] as APIActionRowComponent<APIButtonComponent>).components.map((b) => b.label)).toEqual(["Copy as text"]);
  });

  it("asks about a private deck by its Legend's picture", () => {
    const prompt = privatePrompt("Foxy", cards[0], { printings });
    expect(prompt.components[0]).toMatchObject({ type: ComponentType.Section, accessory: { media: { url: expect.stringContaining("cdn.test/l.png") } } });
    expect(texts(prompt.components[0])).toEqual(["**Foxy** is private, so nobody else could open it. Who may see it?"]);
    expect(privatePrompt("Foxy", null, { printings }).components[0].type).toBe(ComponentType.TextDisplay);
  });
});

describe("curveBars", () => {
  const curve = (...counts: number[]) => counts.map((count, i) => ({ energy: i === counts.length - 1 ? `${i}+` : String(i), count }));
  it("an empty deck is all slivers", () => {
    expect(curveBars(curve(0, 0, 0))).toBe("0  ▏ 0\n1  ▏ 0\n2+ ▏ 0");
  });
  it("one bucket is a full bar, the N+ bucket lines up with the rest", () => {
    expect(curveBars(curve(0, 4, 0))).toBe(`0  ▏ 0\n1  ${"█".repeat(16)} 4\n2+ ▏ 0`);
    expect(curveBars(curve(0, 0, 3))).toBe(`0  ▏ 0\n1  ▏ 0\n2+ ${"█".repeat(16)} 3`);
  });
  it("scales the longest bar to 16 blocks, and a single copy still shows", () => {
    const rows = curveBars(curve(1, 8, 40, 4)).split("\n");
    expect(rows.map((r) => r.match(/█*/g)!.join("").length)).toEqual([1, 3, 16, 2]);
    expect(rows[2]).toBe(`2  ${"█".repeat(16)} 40`);
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
