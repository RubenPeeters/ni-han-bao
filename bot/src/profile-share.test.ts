import { readFileSync } from "node:fs";
import { ButtonStyle, ComponentType, MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import { collectionShare, wishlistShare, type Sharer } from "./profile-share.js";
import type { Catalogue } from "./riftbound.js";
import type { Wanted } from "./wishlist.js";

const catalogue = JSON.parse(readFileSync(new URL("../riftbound-cards.json", import.meta.url), "utf8")) as Catalogue;
const emojis = new Map([["rb_showcase", "5"], ["rb_fury", "1"]]);
const SITE = "https://nexus.example";
const anna = (visibility: string | null): Sharer => ({ id: "42", name: "Anna", visibility });
const shown = (reply: unknown) => JSON.stringify(reply);
const want = (card_id: string, wanted: number, printing_id: string | null = null, playset = 0): Wanted => ({
  card_id,
  printing_id,
  language: null,
  decks: wanted - playset,
  manual: null,
  goal: playset ? 3 : null,
  wanted,
  playset,
});

describe("/collection share", () => {
  const owned = [
    { printing_id: "ogn-001-298", quantity: 3 },
    { printing_id: "ogn-002-298", quantity: 1 },
    { printing_id: "ogn-030a-298", quantity: 1 },
    { printing_id: "ogn-001-298", quantity: 2 },
  ];

  it("posts the total, the count per set and the rarest cards first, with a link to the profile's collection", () => {
    const reply = collectionShare(anna("public"), owned, catalogue, emojis, SITE);
    expect(reply).toMatchObject({ flags: MessageFlags.IsComponentsV2 });
    const text = shown(reply);
    expect(text).toContain("Anna's collection · 7 cards");
    expect(text).toContain("**OGN** Origins · 7 cards");
    // The Showcase printing leads, with its emoji and picture; each printing once.
    expect(text.indexOf("<:rb_showcase:5> **Jinx")).toBeGreaterThan(-1);
    expect(text.indexOf("Jinx")).toBeLessThan(text.indexOf("Blazing Scorcher"));
    expect(text.match(/Blazing Scorcher\*\*/g)).toHaveLength(1);
    expect(text).toContain('"type":11');
    expect((reply as { components: unknown[] }).components[1]).toEqual({
      type: ComponentType.ActionRow,
      components: [{ type: ComponentType.Button, style: ButtonStyle.Link, label: "Open collection", url: `${SITE}/u/42/collection` }],
    });
    expect(text).not.toContain("only for members");
  });

  it("says the link opens only for members of their servers when the profile is for members", () => {
    expect(shown(collectionShare(anna("members"), owned, catalogue, emojis, SITE))).toContain("The link opens only for members of Anna's servers.");
  });

  it("keeps to the top 5 rarest", () => {
    const many = catalogue.printings.slice(0, 20).map((p) => ({ printing_id: p.id, quantity: 1 }));
    const reply = collectionShare(anna("public"), many, catalogue, emojis, SITE) as { components: { components: unknown[] }[] };
    expect(shown(reply).match(/"type":11/g)).toHaveLength(5);
  });

  it("posts an empty collection as such", () => {
    expect(shown(collectionShare(anna("public"), [], catalogue, emojis, SITE))).toContain("Anna's collection · 0 cards");
  });

  it("posts nothing for a private profile or none yet, and says what to change", () => {
    for (const v of ["private", null]) {
      const reply = collectionShare(anna(v), owned, catalogue, emojis, SITE);
      expect(typeof reply).toBe("string");
      expect(reply).toContain(`${SITE}/settings#profile`);
    }
  });
});

describe("/wishlist share", () => {
  it("lists wanted cards by name with their counts and pins, and links to the profile's wishlist", () => {
    const reply = wishlistShare(anna("public"), [want("jinx-demolitionist", 2, "ogn-030a-298"), want("blazing-scorcher", 1), want("abandon", 0)], catalogue, emojis, SITE);
    const text = shown(reply);
    expect(text).toContain("Anna's wishlist · 3 cards");
    expect(text).toContain("1× **Blazing Scorcher** <:rb_fury:1>");
    expect(text).toContain("2× **Jinx, Demolitionist**");
    expect(text).toContain("only OGN-030a/298");
    expect(text.indexOf("Blazing")).toBeLessThan(text.indexOf("Jinx"));
    expect(text).not.toContain("Abandon");
    expect(text).toContain(`${SITE}/u/42/wishlist`);
  });

  it("shows the first 10 and how many more", () => {
    const rows = catalogue.cards.slice(0, 12).map((c) => want(c.id, 1));
    const text = shown(wishlistShare(anna("members"), rows, catalogue, emojis, SITE));
    expect(text).toContain("· 12 cards");
    expect(text.match(/1× /g)).toHaveLength(10);
    expect(text).toContain("and 2 more");
    expect(text).toContain("only for members of Anna's servers");
  });

  it("lists the playset goal after the decks, so it cannot bury them", () => {
    const goal = catalogue.cards.slice(0, 12).map((c) => want(c.id, 3, null, 3));
    const text = shown(wishlistShare(anna("public"), [...goal, want("jinx-demolitionist", 3, null, 1)], catalogue, emojis, SITE));
    expect(text).toContain("· 39 cards");
    expect(text.indexOf("2× **Jinx, Demolitionist**")).toBeLessThan(text.indexOf("playset goal"));
    expect(text).toContain("and 4 more");
  });

  it("posts nothing for a private profile", () => {
    expect(wishlistShare(anna("private"), [want("abandon", 1)], catalogue, emojis, SITE)).toContain("Your profile is private");
  });
});
