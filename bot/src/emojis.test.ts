import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { EMOJI_MAX_BYTES, emoji, emojiImage, emojiPlan, wantedEmojis } from "./emojis.js";
import type { FeedIcon } from "./riftbound-feed.js";

const { icons } = JSON.parse(readFileSync(new URL("../riftbound-cards.json", import.meta.url), "utf8")) as { icons: FeedIcon[] };

describe("the Riftbound emojis", () => {
  it("are the 6 domains, 6 types, 5 rarities, champion, might and power", () => {
    const names = wantedEmojis(icons).map((e) => e.name);
    expect(names).toHaveLength(20);
    expect(names).toEqual(expect.arrayContaining(["rb_fury", "rb_unit", "rb_battlefield", "rb_rare", "rb_champion", "rb_might", "rb_power"]));
    expect(names).not.toContain("rb_illustrator");
    expect(names).not.toContain("rb_mightBonus");
  });

  it("creates what is missing, replaces a changed or unknown source and leaves the rest alone", () => {
    const wanted = [
      { name: "rb_fury", url: "https://x/fury-2.png" },
      { name: "rb_calm", url: "https://x/calm.png" },
      { name: "rb_mind", url: "https://x/mind.png" },
      { name: "rb_body", url: "https://x/body.png" },
    ];
    const existing = [
      { id: "1", name: "rb_fury" },
      { id: "2", name: "rb_calm" },
      { id: "3", name: "rb_mind" },
      { id: "9", name: "someone_elses" },
    ];
    const stored = [
      { name: "rb_fury", emoji_id: "1", source_url: "https://x/fury-1.png" },
      { name: "rb_calm", emoji_id: "2", source_url: "https://x/calm.png" },
    ];
    const plan = emojiPlan(wanted, existing, stored);
    expect([...plan.keep]).toEqual([["rb_calm", "2"]]);
    expect(plan.replace).toEqual([
      { name: "rb_fury", url: "https://x/fury-2.png", old: "1" },
      { name: "rb_mind", url: "https://x/mind.png", old: "3" },
    ]);
    expect(plan.create).toEqual([{ name: "rb_body", url: "https://x/body.png" }]);
  });

  it("resizes a big icon to 128 px, keeping its aspect, and draws an SVG glyph", async () => {
    const big = await sharp({ create: { width: 800, height: 400, channels: 4, background: "#ff0000" } }).png().toBuffer();
    const out = await emojiImage(big);
    expect(await sharp(out).metadata()).toMatchObject({ format: "png", width: 128, height: 64 });
    expect(out.length).toBeLessThanOrEqual(EMOJI_MAX_BYTES);
    const small = await sharp({ create: { width: 24, height: 24, channels: 4, background: "#00ff00" } }).png().toBuffer();
    expect(await sharp(await emojiImage(small)).metadata()).toMatchObject({ width: 24, height: 24 });
    const svg = Buffer.from('<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M2 2h20v20z" fill="white"/></svg>');
    expect(await sharp(await emojiImage(svg)).metadata()).toMatchObject({ format: "png", width: 128, height: 128 });
  });

  it("writes an emoji as Discord's mention, or nothing without it", () => {
    expect(emoji(new Map([["rb_might", "5"]]), "rb_might")).toBe("<:rb_might:5>");
    expect(emoji(new Map(), "rb_might")).toBeNull();
  });
});
