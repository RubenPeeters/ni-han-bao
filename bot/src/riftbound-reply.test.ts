import { readFileSync } from "node:fs";
import { ComponentType, MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import type { FeedIcon } from "./riftbound-feed.js";
import type { Catalogue, Printing } from "./riftbound.js";
import { MAX_COMPONENTS, MAX_TEXT, accentColor, cardHeading, cardMessage, cardSection, discordRules, fitLines } from "./riftbound-reply.js";

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
  it("shows the image, heading, rules text, printings with rarities and a link", () => {
    const message = cardMessage(card("nine-tailed-fox"), printed("nine-tailed-fox"), catalogue.icons, emojis, "https://site.test/");
    expect(message.flags).toBe(MessageFlags.IsComponentsV2);
    const [container, row] = message.components as unknown as [
      { accent_color: number; components: { type: number; content?: string; items?: { media: { url: string } }[] }[] },
      { components: { url: string; label: string }[] },
    ];
    expect(container.accent_color).toBe(0x152311);
    expect(container.components.map((c) => c.type)).toEqual([
      ComponentType.MediaGallery,
      ComponentType.TextDisplay,
      ComponentType.Separator,
      ComponentType.TextDisplay,
      ComponentType.Separator,
      ComponentType.TextDisplay,
    ]);
    expect(new URL(container.components[0].items![0].media.url).searchParams.get("w")).toBe("600");
    expect(container.components[3].content).toContain("give it -1 <:rb_might:1> this turn");
    expect(container.components[5].content).toBe("<:rb_rare:8> **OGN-255/298** · Rare\n**OGN-303\\*/298** · Showcase\n**OGN-303/298** · Showcase");
    expect(row.components[0]).toMatchObject({ label: "Card page", url: "https://site.test/cards/nine-tailed-fox" });
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
    const many: Printing[] = Array.from({ length: 300 }, (_, i) => ({ ...printed("nine-tailed-fox")[0], id: `p${i}`, collector_code: `OGN-${i}/298` }));
    const { components } = cardMessage(card("nine-tailed-fox"), many, catalogue.icons, emojis, "https://site.test");
    expect(count(components).text).toBeLessThanOrEqual(MAX_TEXT);
    expect(JSON.stringify(components)).toMatch(/and \d+ more: https:\/\/site.test\/cards\/nine-tailed-fox/);
  });
});
