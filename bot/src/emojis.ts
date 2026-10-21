// Riot's official Riftbound icons (#218) as the bot's application emojis (#224), so replies
// show them inline. Riot's icon files are copied to Discord here: the owner's decision.
import sharp from "sharp";

/** Emoji name to emoji id, for the replies; an icon missing from it is written as words. */
export type Emojis = ReadonlyMap<string, string>;

export interface EmojiSource {
  name: string;
  url: string;
}

// Discord's emoji names: 2 to 32 letters, digits and underscores.
const NAME = /^rb_\w{1,29}$/;
const GLYPHS = new Set(["might", "power"]);

/** The icons that become emojis: domains, card types, rarities, the champion supertype, might and power. */
export function wantedEmojis(icons: { facet: string; value: string; icon_url: string }[]): EmojiSource[] {
  return icons
    .filter(
      (i) =>
        ["domain", "type", "rarity"].includes(i.facet) ||
        (i.facet === "supertype" && i.value === "champion") ||
        (i.facet === "glyph" && GLYPHS.has(i.value)),
    )
    .map((i) => ({ name: `rb_${i.value}`, url: i.icon_url }))
    .filter((e) => NAME.test(e.name));
}

export interface EmojiPlan {
  // Name to id of the emojis already made from today's icon.
  keep: Map<string, string>;
  create: (EmojiSource & { old?: never })[];
  // `old` is the emoji to delete: Discord cannot change an emoji's image.
  replace: (EmojiSource & { old: string })[];
}

/**
 * What to upload, against the application's emojis and the source each was made from
 * (riftbound_emojis). An emoji of an unknown source is replaced; any other emoji is left alone.
 */
export function emojiPlan(
  wanted: EmojiSource[],
  existing: { id: string; name: string | null }[],
  stored: { name: string; emoji_id: string; source_url: string }[],
): EmojiPlan {
  const plan: EmojiPlan = { keep: new Map(), create: [], replace: [] };
  for (const w of wanted) {
    const emoji = existing.find((e) => e.name === w.name);
    const source = stored.find((s) => s.name === w.name);
    if (!emoji) plan.create.push(w);
    else if (source?.emoji_id === emoji.id && source.source_url === w.url) plan.keep.set(w.name, emoji.id);
    else plan.replace.push({ ...w, old: emoji.id });
  }
  return plan;
}

export const EMOJI_MAX_BYTES = 256 * 1024;

/** An icon file as an emoji: a PNG of at most 128 px a side, its aspect kept; SVG glyphs drawn sharp. */
export async function emojiImage(file: Buffer): Promise<Buffer> {
  // 384 dpi draws Riot's 24 px glyphs at 128 px.
  const png = await sharp(file, { density: 384 })
    .resize(128, 128, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  if (png.length > EMOJI_MAX_BYTES) throw new Error(`emoji image is ${png.length} bytes, over Discord's ${EMOJI_MAX_BYTES}`);
  return png;
}

/** `<:rb_fury:123>`, or null when the emoji is not there. */
export function emoji(emojis: Emojis, name: string): string | null {
  const id = emojis.get(name);
  return id ? `<:${name}:${id}>` : null;
}
