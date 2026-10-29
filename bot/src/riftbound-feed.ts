// The real Riftbound cards (#203), from the feed behind Riot's own card gallery: no key, no
// authentication, ported from riftbound-db's scripts/fetch-cards.ts. The feed is an internal
// detail of Riot's site, so every shape it relies on is checked and a change fails loudly.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { SET_NAMES } from "./card-match.js";
import { printingFindings, runeFindings, staleFindings, type Finding } from "./riftbound-checks.js";
import { catalogueJson, type Card, type Printing } from "./riftbound.js";

export const SITE_URL = "https://playriftbound.com/en-us/";
export const galleryUrl = (buildId: string) =>
  `https://playriftbound.com/_next/data/${buildId}/en-us/card-gallery.json`;

// Release order, oldest first. The feed has no dates. Source: Riot's "Products and Sets into
// 2027" (https://playriftbound.com/en-us/news/announcements/products-and-sets-into-2027/):
// Origins and its Proving Grounds, Spiritforged, Unleashed ("third set"), Vendetta, Radiance
// ("Set 5"). A new set must be added to SET_NAMES, with the feed's name for it, or the script fails.
export const SET_ORDER = Object.keys(SET_NAMES);

// Riot's empty card types (tokens, some RAD cards) are a null type, unlike the placeholders.
export type FeedCard = Omit<Card, "type"> & { type: string | null };
// The official text as the feed gives it: HTML with icon tokens such as ":rb_energy_1:".
export type FeedPrinting = Printing & { rules_text: string | null; effect_text: string | null };
// Riot's official icon of one facet value (#218), referenced on Riot's CDN, never rehosted: facet
// "type", "supertype", "rarity" or "domain" with the feed's value id ("fury"), or "glyph" with
// the feed field whose values all share one glyph ("might", "power", "illustrator").
export interface FeedIcon {
  facet: string;
  value: string;
  label: string;
  icon_url: string;
  color_primary: string | null;
  color_secondary: string | null;
}

export interface FeedCatalogue {
  cards: FeedCard[];
  printings: FeedPrinting[];
  icons: FeedIcon[];
  // Card ids with an empty type in the feed.
  untyped: string[];
  // Cards whose printings differ in rules text (errata, templating), printing ids per text.
  textDifferences: { card_id: string; printings: string[][] }[];
  // Values another source disagrees with (#324), in the manifest and the proposal DM.
  findings: Finding[];
}

// Riot's feed has the wrong type or domain on some cards (#323): what the card itself shows, per
// card id, with the printing it was read from and how ("image alt text" for the type, "card image"
// for the domain symbol).
export interface Correction {
  printing: string;
  type?: string;
  domains?: string[];
  source: string[];
  // A wrong icon token in the printing's rules text (#328): the feed's token and the printed one.
  text?: { feed: string; printed: string; source: string }[];
  // The printing's rune tokens name another domain on purpose, checked on the card (#328).
  runes_checked?: boolean;
}
export type Corrections = Record<string, Correction>;
export const CORRECTIONS: Corrections = JSON.parse(
  readFileSync(new URL("../riftbound-corrections.json", import.meta.url), "utf8"),
);

/** The card as it is printed: the correction's type and domains over the feed's. */
export const correct = (card: FeedCard, c: Correction | undefined): FeedCard =>
  c ? { ...card, type: c.type ?? card.type, domains: c.domains ?? card.domains } : card;

const occurrences = (text: string | null, token: string) => (text ?? "").split(token).length - 1;

/**
 * The printing's rules text as printed: each text correction's token replaced, where it occurs
 * exactly once, so the rest stays Riot's text. Already fixed by Riot is left to staleFindings.
 */
export function correctText(text: string | null, c: Correction): string | null {
  for (const t of c.text ?? []) {
    const n = occurrences(text, t.feed);
    if (n === 0 && occurrences(text, t.printed) > 0) continue;
    if (n !== 1) throw new Error(`text correction for ${c.printing}: ${t.feed} occurs ${n} times in its rules text, expected once`);
    text = text!.split(t.feed).join(t.printed);
  }
  return text;
}

/** The build id in Riot's home page, which changes on every deploy of their site. */
export function buildId(html: string): string {
  const m = /"buildId":"([^"]+)"/.exec(html);
  if (!m) throw new Error(`no "buildId" in ${SITE_URL}`);
  return m[1];
}

async function get(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

export async function fetchFeed(): Promise<{ url: string; buildId: string; feed: unknown }> {
  const id = buildId(await (await get(SITE_URL)).text());
  const url = galleryUrl(id);
  return { url, buildId: id, feed: await (await get(url)).json() };
}

/** The one array of objects with a `publicCode`, wherever the page puts it. */
export function feedItems(feed: unknown): unknown[] {
  const found: unknown[][] = [];
  const walk = (o: unknown) => {
    if (Array.isArray(o)) {
      if (o.length && o.every((x) => typeof x === "object" && x !== null && "publicCode" in x)) found.push(o);
      else o.forEach(walk);
    } else if (typeof o === "object" && o !== null) Object.values(o).forEach(walk);
  };
  walk(feed);
  if (found.length !== 1) throw new Error(`expected one card array in the feed, found ${found.length}`);
  return found[0];
}

// A missing or mistyped field is a changed feed: fail, never guess.
function fail(code: string, what: string): never {
  throw new Error(`feed card ${code}: unexpected ${what}`);
}
const obj = (v: unknown, code: string, what: string) =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(code, what);
const str = (v: unknown, code: string, what: string) => (typeof v === "string" && v ? v : fail(code, what));
const list = (v: unknown, code: string, what: string) => (Array.isArray(v) ? v : fail(code, what));
const labels = (v: unknown, code: string, what: string) =>
  list(v, code, what).map((x) => str(obj(x, code, what).label, code, `${what} label`));
const optional = <T>(v: unknown, read: (v: unknown) => T): T | null => (v === undefined ? null : read(v));
// Icons only from Riot's own CDNs: nothing from another source.
const RIOT_CDN = /^https:\/\/(cmsassets|assetcdn)\.rgpub\.io\//;
const hex = (v: unknown, code: string, what: string) =>
  v === undefined ? null : typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : fail(code, what);

/** "Ahri Inquisitive" -> "ahri-inquisitive", "Kai'Sa" -> "kaisa". */
export const slug = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").replace(/['‘’]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Only for comparing printings: markup, spacing and reminder text (in parentheses, which
// alternate-art printings leave out) are not wording.
const comparable = (html: string | null) =>
  (html ?? "").replace(/<br\s*\/?>/g, " ").replace(/<[^>]*>/g, "").replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ").replace(/\s+([.,])/g, "$1").trim();

interface Parsed {
  card: FeedCard;
  printing: FeedPrinting;
  icons: FeedIcon[];
  rank: number;
  // The image's alt text, which names the card's type.
  alt: string | null;
}

function parse(raw: unknown): Parsed {
  const r = obj(raw, "?", "card");
  const code = str(r.publicCode, "?", "publicCode");
  const html = (v: unknown, what: string) => {
    const rich = obj(obj(v, code, what).richText, code, `${what} richText`);
    if (rich.type !== "html") fail(code, `${what} type ${String(rich.type)}`);
    return str(rich.body, code, `${what} body`);
  };
  const value = (v: unknown, what: string) => {
    const n = obj(obj(v, code, what).value, code, what).id;
    return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : fail(code, what);
  };
  const icons: FeedIcon[] = [];
  const icon = (facet: string, value: string, label: string, v: unknown) => {
    if (v === undefined) return;
    const i = obj(v, code, `${facet} icon`);
    const url = str(i.url, code, `${facet} icon url`);
    if (!RIOT_CDN.test(url)) fail(code, `${facet} icon url ${url}`);
    const colors = i.colors === undefined ? {} : obj(i.colors, code, `${facet} icon colors`);
    icons.push({
      facet, value, label, icon_url: url,
      color_primary: hex(colors.primary, code, `${facet} icon colors`),
      color_secondary: hex(colors.secondary, code, `${facet} icon colors`),
    });
  };
  // A faceted value's label, its icon noted.
  const facet = (v: unknown, name: string) => {
    const e = obj(v, code, name);
    const label = str(e.label, code, `${name} label`);
    icon(name, str(e.id, code, `${name} id`), label, e.icon);
    return label;
  };
  const facets = (v: unknown, name: string) => list(v, code, name).map((x) => facet(x, name));
  for (const field of ["might", "mightBonus", "power", "illustrator"]) {
    if (r[field] === undefined) continue;
    const f = obj(r[field], code, field);
    for (const x of f.values === undefined ? [f.value] : list(f.values, code, field))
      icon("glyph", field, str(f.label, code, `${field} label`), obj(x, code, field).icon);
  }
  const setValue = obj(obj(r.set, code, "set").value, code, "set");
  const set = str(setValue.id, code, "set id");
  const rank = SET_ORDER.indexOf(set);
  if (rank < 0) throw new Error(`feed card ${code}: set ${set} is not in SET_ORDER, add it with its release order`);
  // The site shows SET_NAMES: a renamed set fails here, never shows a stale name.
  if (str(setValue.label, code, "set label") !== SET_NAMES[set]) fail(code, `set ${set} label`);
  const cardType = obj(r.cardType, code, "cardType");
  const types = facets(cardType.type, "type");
  if (types.length > 1) fail(code, `types ${types.join(", ")}`);
  const name = str(r.name, code, "name");
  const subtitle = optional(r.subtitle, (v) => str(v, code, "subtitle"));
  const number = r.collectorNumber;
  if (typeof number !== "number" || !Number.isInteger(number)) fail(code, "collectorNumber");
  const rulesText = optional(r.text, (v) => html(v, "text"));
  const illustrators = labels(obj(r.illustrator, code, "illustrator").values, code, "illustrator");
  const image = obj(r.cardImage, code, "cardImage");
  const card: FeedCard = {
    id: slug(subtitle ? `${name} ${subtitle}` : name),
    name: subtitle ? `${name}, ${subtitle}` : name,
    type: types[0] ?? null,
    supertypes: optional(cardType.superType, (v) => facets(v, "supertype")) ?? [],
    domains: facets(obj(r.domain, code, "domain").values, "domain"),
    energy: optional(r.energy, (v) => value(v, "energy")),
    might: optional(r.might, (v) => value(v, "might")),
    tags: optional(r.tags, (v) => list(obj(v, code, "tags").tags, code, "tags").map((t) => str(t, code, "tag"))) ?? [],
    rules_text: rulesText,
    placeholder: false,
  };
  const printing: FeedPrinting = {
    id: str(r.id, code, "id"),
    card_id: card.id,
    set_code: set,
    collector_code: code,
    collector_number: number,
    rarity: facet(obj(r.rarity, code, "rarity").value, "rarity"),
    illustrator: illustrators.length ? illustrators.join(", ") : null,
    image_url: str(image.url, code, "image url"),
    rules_text: rulesText,
    effect_text: optional(r.effect, (v) => html(v, "effect")),
  };
  return { card, printing, icons, rank, alt: optional(image.accessibilityText, (v) => str(v, code, "image alt text")) };
}

/** The raw feed cards to rows of riftbound_cards and riftbound_printings, sorted by id. */
export function transformFeed(items: unknown[], corrections: Corrections = {}): FeedCatalogue {
  const bySlug = new Map<string, Parsed[]>();
  const icons = new Map<string, FeedIcon>();
  const findings: Finding[] = [];
  const parsed = items.map(parse);
  for (const p of parsed) {
    const c = corrections[p.card.id];
    if (c?.printing === p.printing.collector_code) {
      findings.push(...staleFindings(p.card, c, p.printing.image_url!));
      p.printing.rules_text = p.card.rules_text = correctText(p.printing.rules_text, c);
    }
    p.card = correct(p.card, c);
    bySlug.set(p.card.id, [...(bySlug.get(p.card.id) ?? []), p]);
    for (const i of p.icons) {
      const key = `${i.facet}:${i.value}`;
      const was = icons.get(key);
      if (was && JSON.stringify(was) !== JSON.stringify(i)) throw new Error(`icon ${key} differs between cards`);
      icons.set(key, i);
    }
  }

  // A correction that no longer fits the feed is a changed feed: fail like any other shape.
  const labels = (facet: string) => new Set([...icons.values()].filter((i) => i.facet === facet).map((i) => i.label));
  const [types, domains] = [labels("type"), labels("domain")];
  for (const [id, c] of Object.entries(corrections)) {
    if (!bySlug.get(id)?.some((p) => p.printing.collector_code === c.printing))
      throw new Error(`correction for ${id}: no printing ${c.printing} of it in the feed`);
    if (c.type !== undefined && !types.has(c.type)) throw new Error(`correction for ${id}: unknown type ${c.type}`);
    for (const d of c.domains ?? []) if (!domains.has(d)) throw new Error(`correction for ${id}: unknown domain ${d}`);
    for (const t of c.text ?? [])
      if (![t.feed, t.printed].every((x) => /^:rb_[a-z0-9_]+:$/.test(x))) throw new Error(`correction for ${id}: text ${t.feed} to ${t.printed} is not one icon token`);
  }
  for (const p of parsed)
    findings.push(...printingFindings(p.card, p.printing, p.alt, types), ...runeFindings(p.card, p.printing, corrections[p.card.id]));

  const cards: FeedCard[] = [];
  const printings: FeedPrinting[] = [];
  const textDifferences: FeedCatalogue["textDifferences"] = [];
  for (const [id, group] of [...bySlug].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const names = new Set(group.map((p) => p.card.name));
    if (names.size > 1) throw new Error(`card id ${id} is shared by different names: ${[...names].join(" / ")}`);
    group.sort((a, b) => (a.printing.id < b.printing.id ? -1 : 1));
    // The card is its newest printing; within one set, the first by id (the base art).
    const newest = group.reduce((best, p) => (p.rank > best.rank ? p : best));
    cards.push(newest.card);
    printings.push(...group.map((p) => p.printing));
    const texts = new Map<string, string[]>();
    for (const { printing } of group) {
      const key = comparable(printing.rules_text);
      texts.set(key, [...(texts.get(key) ?? []), printing.id]);
    }
    if (texts.size > 1) textDifferences.push({ card_id: id, printings: [...texts.values()] });
  }
  printings.sort((a, b) => (a.id < b.id ? -1 : 1));
  const repeated = printings.filter((p, i) => i > 0 && printings[i - 1].id === p.id).map((p) => p.id);
  if (repeated.length) throw new Error(`the feed repeats printing ids: ${repeated.join(", ")}`);
  return {
    cards,
    printings,
    icons: [...icons.values()].sort((a, b) => (a.facet < b.facet ? -1 : a.facet > b.facet ? 1 : a.value < b.value ? -1 : 1)),
    untyped: cards.filter((c) => c.type === null).map((c) => c.id), textDifferences,
    findings: findings.sort((a, b) => findingKey(a).localeCompare(findingKey(b))) };
}

const findingKey = (f: Finding) => `${f.printing} ${f.check} ${f.feed}`;

export const cardsJson = ({ cards, printings, icons }: FeedCatalogue) => catalogueJson({ cards, printings, icons });

export function manifest(catalogue: FeedCatalogue, json: string, source: { url: string; buildId: string; fetchedAt: Date }) {
  const sets: Record<string, number> = Object.fromEntries(SET_ORDER.map((s) => [s, 0]));
  for (const p of catalogue.printings) sets[p.set_code]++;
  return `${JSON.stringify(
    {
      source: source.url,
      build_id: source.buildId,
      fetched_at: source.fetchedAt.toISOString(),
      cards: catalogue.cards.length,
      printings: catalogue.printings.length,
      printings_per_set: sets,
      sha256: createHash("sha256").update(json).digest("hex"),
      untyped: catalogue.untyped,
      text_differences: catalogue.textDifferences,
      findings: catalogue.findings,
    },
    null,
    2,
  )}\n`;
}
