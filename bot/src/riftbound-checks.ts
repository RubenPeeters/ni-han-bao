// Value checks on Riot's card feed (#324): a well-formed but wrong value passes the shape checks
// in riftbound-feed.ts, so each check here compares the feed with a second source. Findings are
// reported, never applied and never fatal: a correction is a human decision (#323).
import sharp from "sharp";
import type { Correction, FeedCard, FeedPrinting } from "./riftbound-feed.js";

export interface Finding {
  check: "type" | "missing" | "domain symbol" | "stale correction";
  // The printing's collector code.
  printing: string;
  feed: string;
  // The other source's value, named with the source; null when there is none (missing values).
  other: string | null;
  image_url: string;
}

const isToken = (card: FeedCard) => card.supertypes.includes("Token");

/**
 * The type in the image's alt text ("Riftbound Gear: Blade of the Exile. …"): a known type, null
 * for none ("Riftbound : Buff." and "Riftbound None: XP Tracker.", both tokens), or undefined when
 * the text is not in that pattern ("Riftbound Unit, Gear: …").
 */
export function altType(alt: string | null, types: Set<string>): string | null | undefined {
  const m = /^Riftbound ([^:]*): /.exec(alt ?? "");
  if (!m) return undefined;
  if (m[1] === "" || m[1] === "None") return null;
  return types.has(m[1]) ? m[1] : undefined;
}

/** Checks 1 and 2: one printing's card, after corrections, against its alt text and for missing values. */
export function printingFindings(card: FeedCard, printing: FeedPrinting, alt: string | null, types: Set<string>): Finding[] {
  const at = { printing: printing.collector_code, image_url: printing.image_url ?? "" };
  const findings: Finding[] = [];
  const fromAlt = altType(alt, types);
  if (fromAlt === undefined)
    findings.push({ ...at, check: "type", feed: card.type ?? "no type", other: `alt text ${JSON.stringify((alt ?? "").slice(0, 40))} not understood` });
  else if (fromAlt !== card.type)
    findings.push({ ...at, check: "type", feed: card.type ?? "no type", other: `alt text ${fromAlt ?? "no type"}` });
  if (!isToken(card)) {
    if (card.type === null) findings.push({ ...at, check: "missing", feed: "no type", other: null });
    if (card.domains.length === 0) findings.push({ ...at, check: "missing", feed: "no domain", other: null });
  }
  return findings;
}

/** Check 4: what of a correction the uncorrected feed now agrees with, so it can be removed. */
export function staleFindings(feed: FeedCard, c: Correction, image_url: string): Finding[] {
  const at = { check: "stale correction" as const, printing: c.printing, image_url };
  return [
    ...(c.type !== undefined && c.type === feed.type ? [{ ...at, feed: feed.type, other: `correction ${c.type}` }] : []),
    ...(c.domains !== undefined && JSON.stringify(c.domains) === JSON.stringify(feed.domains)
      ? [{ ...at, feed: feed.domains.join(", "), other: `correction ${c.domains.join(", ")}` }]
      : []),
  ];
}

// The domain symbol's hue in degrees, measured on all 933 single-domain printings outside
// Radiance on 2026-10-29: each domain stays within 5° of these.
const SYMBOL_HUES: Record<string, number> = { Fury: 356, Body: 29, Order: 51, Calm: 102, Mind: 203, Chaos: 272 };
const HUE_TOLERANCE = 15;
// The corner the symbol sits in, as fractions of the card (bottom right).
const CORNER = { left: 0.905, top: 0.945, width: 0.055, height: 0.035 };

/**
 * The domain whose colour fills the symbol in a crop of the card's bottom-right corner (RGB or
 * RGBA pixels), or null when too few saturated pixels or no domain's hue is close: never a guess.
 */
export function symbolDomain({ data, width, height, channels }: { data: Uint8Array; width: number; height: number; channels: number }): string | null {
  const radius = Math.min(width, height) / 3;
  const hues: number[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if ((x + 0.5 - width / 2) ** 2 + (y + 0.5 - height / 2) ** 2 > radius ** 2) continue;
      const i = (y * width + x) * channels;
      const [r, g, b] = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      // The symbol's white glyph and a dimmed symbol are not its colour.
      if (max < 0.35 || d / max < 0.5) continue;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      hues.push((h * 60 + 360) % 360);
    }
  if (hues.length < 50) return null;
  const hue = hues.sort((a, b) => a - b)[hues.length >> 1];
  const distance = (d: string) => Math.min(Math.abs(hue - SYMBOL_HUES[d]), 360 - Math.abs(hue - SYMBOL_HUES[d]));
  const nearest = Object.keys(SYMBOL_HUES).reduce((a, b) => (distance(a) <= distance(b) ? a : b));
  return distance(nearest) <= HUE_TOLERANCE ? nearest : null;
}

/** The bottom-right corner of a card image, as raw pixels. */
export async function symbolCrop(image: Buffer) {
  const { width = 0, height = 0 } = await sharp(image).metadata();
  const { data, info } = await sharp(image)
    .extract({
      left: Math.round(width * CORNER.left), top: Math.round(height * CORNER.top),
      width: Math.round(width * CORNER.width), height: Math.round(height * CORNER.height),
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/**
 * Check 3: the domain symbol on Riot's image of each printing whose card has one domain or none,
 * against the card's domain after corrections. Full-art cards can be misread, so this only reports.
 * Images are read from Riot's CDN and never stored.
 */
export async function symbolFindings(cards: FeedCard[], printings: FeedPrinting[]): Promise<Finding[]> {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const queue = printings.filter((p) => {
    const domains = byId.get(p.card_id)?.domains;
    return p.image_url && domains && domains.length <= 1 && domains[0] !== "Colorless";
  });
  const findings: Finding[] = [];
  const read = async (p: FeedPrinting) => {
    const feed = byId.get(p.card_id)!.domains[0] ?? "no domain";
    let seen: string | null;
    try {
      const res = await fetch(p.image_url!);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      seen = symbolDomain(await symbolCrop(Buffer.from(await res.arrayBuffer())));
    } catch {
      seen = null;
    }
    if (seen !== feed)
      findings.push({ check: "domain symbol", printing: p.collector_code, feed, other: `card image ${seen ?? "not readable"}`, image_url: p.image_url! });
  };
  // A few at a time: Riot's CDN, not ours.
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let p = queue.shift(); p; p = queue.shift()) await read(p);
  }));
  return findings.sort((a, b) => (a.printing < b.printing ? -1 : 1));
}

export const findingText = (f: Finding) =>
  `${f.printing} ${f.check}: feed ${f.feed}${f.other ? `, ${f.other}` : ""} (${f.image_url})`;
