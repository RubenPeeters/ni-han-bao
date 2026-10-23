import { readFileSync } from "node:fs";
import { ComponentType, MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import type { FeedIcon } from "./riftbound-feed.js";
import type { Catalogue } from "./riftbound.js";
import { MAX_COMPONENTS, MAX_TEXT, accentColor, callerName, cardHeading, cardMessage, cardSection, discordRules, fitLines, pageButtonId, parsePageButtonId, shownPage } from "./riftbound-reply.js";

const catalogue = JSON.parse(readFileSync(new URL("../riftbound-cards.json", import.meta.url), "utf8")) as Catalogue & { icons: FeedIcon[] };
const card = (id: string) => catalogue.cards.find((c) => c.id === id)!;
const printed = (id: string) => catalogue.printings.filter((p) => p.card_id === id);
const emojis = new Map(["rb_might", "rb_fury", "rb_calm", "rb_mind", "rb_legend", "rb_unit", "rb_champion", "rb_rare"].map((n, i) => [n, String(i + 1)]));
const none = new Map<string, string>();

// Every component, nested ones too, and every string in them, as Discord counts them.
function count(components: unknown[]): { components: number; text: number } {
  let n = 0;
  let text = 0;
  const walk = (c: Record<string, unknown>) => {
    n++;
    for (const key of ["content", "label", "description"]) if (typeof c[key] === "string") text += (c[key] as string).length;
    for (const child of (c.components as Record<string, unknown>[] | undefined) ?? []) walk(child);
    if (c.accessory) walk(c.accessory as Record<string, unknown>);
    for (const item of (c.items as { description?: string }[] | undefined) ?? []) text += item.description?.length ?? 0;
  };
  components.forEach((c) => walk(c as Record<string, unknown>));
  return { components: n, text };
}

describe("rules text in Discord", () => {
  const html = "<p>:rb_exhaust:: [Add] :rb_energy_1::rb_rune_fury:. Pay :rb_rune_rainbow::rb_rune_rainbow:. +1 :rb_might:</p>";

  it("shows Riot's icons as the bot's emojis, energy in bold", () => {
    expect(discordRules(html, emojis)).toBe("exhaust: [Add] **1** <:rb_fury:2>. Pay any rune any rune. +1 <:rb_might:1>");
  });

  it("falls back to words without the emojis", () => {
    expect(discordRules(html, none)).toBe("exhaust: [Add] **1** fury rune. Pay any rune any rune. +1 might");
    expect(discordRules("<p>No tokens.</p>", none)).toBe("No tokens.");
  });
});

describe("the shared card layout", () => {
  it("heads a card with its type, domains, energy and might", () => {
    expect(cardHeading(card("nine-tailed-fox"), emojis)).toBe("### Nine-Tailed Fox\n<:rb_legend:5> Legend · <:rb_calm:3> Calm <:rb_mind:4> Mind");
    const unit = card("ahri-alluring");
    expect(cardHeading(unit, none)).toBe(
      `### Ahri, Alluring\nChampion Unit · ${unit.domains.join(" ")} · **${unit.energy}** energy · **${unit.might}** might`,
    );
  });

  it("puts a thumbnail through Riot's CDN next to it, landscape for battlefields", () => {
    const fox = cardSection(card("nine-tailed-fox"), printed("nine-tailed-fox")[0], none);
    expect(fox.type).toBe(ComponentType.Section);
    const url = new URL((fox as { accessory: { media: { url: string } } }).accessory.media.url);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ w: "160", fm: "webp" });
    const altar = cardSection(card("altar-to-unity"), printed("altar-to-unity")[0], none);
    expect(new URL((altar as { accessory: { media: { url: string } } }).accessory.media.url).searchParams.get("w")).toBe("224");
    expect(cardSection(card("nine-tailed-fox"), null, none).type).toBe(ComponentType.TextDisplay);
  });

  it("colours a card by its first domain", () => {
    expect(accentColor(card("nine-tailed-fox"), catalogue.icons)).toBe(0x152311);
    expect(accentColor({ ...card("nine-tailed-fox"), domains: [] }, catalogue.icons)).toBeUndefined();
  });

  it("ends a list that does not fit with how many more, and the link", () => {
    expect(fitLines(["a", "b"], 10, null)).toBe("a\nb");
    const lines = ["a".repeat(10), "b".repeat(10), "c".repeat(10)];
    expect(fitLines(lines, 24, "https://s/c")).toBe("and 3 more: https://s/c");
    expect(fitLines(lines, 25, null)).toBe(`${lines[0]}\nand 2 more`);
  });
});

describe("/card", () => {
  type Page = {
    accent_color: number;
    components: { type: number; content?: string; items?: { media: { url: string } }[] }[];
  };
  type Row = { components: { label: string; url?: string; custom_id?: string; disabled?: boolean }[] };
  const fox = (index: number, printings = printed("nine-tailed-fox")) =>
    cardMessage(card("nine-tailed-fox"), printings, catalogue.icons, emojis, "https://site.test/", index).components as unknown as [Page, Row];
  const footnote = (page: Page) => page.components.at(-1)!.content;
  const imageUrl = (page: Page) => new URL(page.components[0].items![0].media.url);

  it("shows the first printing's image alone, with every version in a footnote", () => {
    const message = cardMessage(card("nine-tailed-fox"), printed("nine-tailed-fox"), catalogue.icons, emojis, "https://site.test/");
    expect(message.flags).toBe(MessageFlags.IsComponentsV2);
    const [page, row] = message.components as unknown as [Page, Row];
    expect(page.accent_color).toBe(0x152311);
    expect(page.components.map((c) => c.type)).toEqual([ComponentType.MediaGallery, ComponentType.TextDisplay]);
    expect(imageUrl(page).searchParams.get("w")).toBe("600");
    expect(footnote(page)).toBe("-# **OGN-255/298** · OGN-303\\*/298 · OGN-303/298");
    expect(row.components.map((b) => [b.label, b.custom_id, b.disabled])).toEqual([
      ["Previous", "card-page:nine-tailed-fox:0", true],
      ["Next", "card-page:nine-tailed-fox:1", false],
      ["Card page", undefined, undefined],
    ]);
    expect(row.components[2].url).toBe("https://site.test/cards/nine-tailed-fox");
  });

  it("pages to the middle and the last printing", () => {
    const [middle, middleRow] = fox(1);
    expect(footnote(middle)).toBe("-# OGN-255/298 · **OGN-303\\*/298** · OGN-303/298");
    expect(imageUrl(middle).pathname).not.toBe(imageUrl(fox(0)[0]).pathname);
    expect(middleRow.components.slice(0, 2).map((b) => [b.custom_id, b.disabled])).toEqual([
      ["card-page:nine-tailed-fox:0", false],
      ["card-page:nine-tailed-fox:2", false],
    ]);
    const [last, lastRow] = fox(2);
    expect(footnote(last)).toBe("-# OGN-255/298 · OGN-303\\*/298 · **OGN-303/298**");
    expect(lastRow.components.slice(0, 2).map((b) => [b.custom_id, b.disabled])).toEqual([
      ["card-page:nine-tailed-fox:1", false],
      ["card-page:nine-tailed-fox:3", true],
    ]);
  });

  it("has no paging buttons for a single printing", () => {
    const [, row] = fox(0, printed("nine-tailed-fox").slice(0, 1));
    expect(row.components.map((b) => b.label)).toEqual(["Card page"]);
  });

  it("shows the collector code and rarity of a printing without an image", () => {
    const [page] = fox(0, [{ ...printed("nine-tailed-fox")[0], image_url: null }]);
    expect(page.components.map((c) => c.content)).toEqual(["<:rb_rare:8> **OGN-255/298** · Rare", "-# **OGN-255/298**"]);
  });

  it("drops Previous and Next once paging ends, keeping the shown printing and pointing to the card page", () => {
    const [page, row] = cardMessage(card("nine-tailed-fox"), printed("nine-tailed-fox"), catalogue.icons, emojis, "https://site.test/", 1, false)
      .components as unknown as [Page, Row];
    expect(row.components.map((b) => b.label)).toEqual(["Card page"]);
    expect(footnote(page)).toBe("-# OGN-255/298 · **OGN-303\\*/298** · OGN-303/298 · see them all on the card page");
    const [bare, ...rows] = cardMessage(card("nine-tailed-fox"), printed("nine-tailed-fox"), catalogue.icons, emojis, null, 1, false)
      .components as unknown as [Page, Row];
    expect(rows).toEqual([]);
    expect(footnote(bare)).toBe("-# OGN-255/298 · **OGN-303\\*/298** · OGN-303/298");
  });

  it("reads the shown page back from a message's paging buttons", () => {
    for (const index of [0, 1, 2]) expect(shownPage(fox(index) as never)).toBe(index);
    expect(shownPage(cardMessage(card("nine-tailed-fox"), printed("nine-tailed-fox"), catalogue.icons, emojis, null, 1, false).components)).toBeNull();
  });

  it("reads a paging button's card and page back", () => {
    expect(parsePageButtonId(pageButtonId("nine-tailed-fox", 2))).toEqual({ cardId: "nine-tailed-fox", index: 2 });
    expect(parsePageButtonId("deck-copy:d1")).toBeNull();
  });

  it("leaves out what a card or the bot does not have", () => {
    const { components } = cardMessage({ ...card("nine-tailed-fox"), rules_text: null }, [], [], none, null);
    expect(components).toHaveLength(1);
    expect((components[0] as { components: unknown[] }).components).toHaveLength(1);
  });

  it("keeps to Discord's limits, whatever the card", () => {
    for (const c of catalogue.cards) {
      const { components } = cardMessage(c, printed(c.id), catalogue.icons, emojis, "https://site.test");
      const n = count(components);
      expect(n.components).toBeLessThanOrEqual(MAX_COMPONENTS);
      expect(n.text).toBeLessThanOrEqual(MAX_TEXT);
    }
  });
});

describe("the caller's name (#250)", () => {
  const user = { displayName: "anna" };
  it("is their server nickname, from a cached member or the raw one of a server the bot is not in", () => {
    expect(callerName({ displayName: "Anna" }, user)).toBe("Anna");
    expect(callerName({ nick: "Anna" }, user)).toBe("Anna");
  });
  it("is their Discord name in a DM, or without a nickname", () => {
    expect(callerName(null, user)).toBe("anna");
    expect(callerName({ nick: null }, user)).toBe("anna");
  });
});
