// Open a pack (#308): an unofficial booster simulation, for fun only. Nothing is stored, spent or
// earned: no table, no collection, no ranking. No imports, so the site imports it from here as it is.

/** A printing as a pack draws it: `type` is its card's (riftbound_cards.type). */
export interface PackPrinting {
  id: string;
  set_code: string;
  collector_code: string;
  collector_number: number;
  rarity: string | null;
  type: string | null;
}

/** Which printings a slot draws from. */
type Pool = "Common" | "Uncommon" | "Rare" | "Rune" | "Any";

export interface PackSlot {
  label: string;
  count: number;
  pool: Pool;
  /** Per card in the slot: the chance it is an Epic instead. */
  epic?: number;
  foil?: boolean;
  /** Where the numbers come from, as the page shows it. */
  source: string;
}

const GUIDES = "Community guides (Sheep Esports, riftbound.gg); not published by Riot.";

/**
 * Per slot, P(Epic) = 1 − √0.75 ≈ 0.134, so that two slots give P(at least one Epic) = 1 − 0.75 = 1/4.
 * Derived from Riot's "Collectability in Riftbound: Origins": about 1 Epic in 4 packs, two possible.
 */
const ORIGINS_EPIC = 1 - Math.sqrt(0.75);

/**
 * The layout per set. A set is offered only once it has a row here; Unleashed reportedly uses a
 * different layout (TCGTalk) and waits until that is confirmed.
 */
export const PACK_LAYOUTS: Record<string, PackSlot[]> = {
  OGN: [
    // 7: community guides.
    { label: "Common", count: 7, pool: "Common", source: GUIDES },
    // 3: community guides.
    { label: "Uncommon", count: 3, pool: "Uncommon", source: GUIDES },
    // 2: community guides; the Epic chance per slot is derived above from Riot's 1 in 4 packs.
    {
      label: "Rare or better",
      count: 2,
      pool: "Rare",
      epic: ORIGINS_EPIC,
      source: `${GUIDES} An Epic replaces a Rare in about 1 of every 4 packs, and two in one pack are possible (Riot, "Collectability in Riftbound: Origins"): ${(ORIGINS_EPIC * 100).toFixed(1)} % per slot.`,
    },
    // 1: community guides; the draw itself (any basic printing, all equally likely) is an assumption.
    { label: "Foil", count: 1, pool: "Any", foil: true, source: `${GUIDES} Assumption: any card of the set, every card equally likely; no rate is published.` },
    // 1: community guides. Tokens are not basic printings (their codes are T-numbered), so only runes come here.
    { label: "Token or rune", count: 1, pool: "Rune", source: GUIDES },
  ],
};

/** The sets a pack can be opened of, in the table's order. */
export const PACK_SETS = Object.keys(PACK_LAYOUTS);

export const PACK_DISCLAIMER =
  "Unofficial simulation for fun. Slot layout from community guides; Riot publishes only that Epics appear in about 1 in 4 packs. Not a real pull and never added to your collection.";

/**
 * A set's normal number, as isBasicPrinting() in lib/collection.ts (which the bot cannot import):
 * no alternate art (`023a`), starred, overnumbered, SP or token printing, whose rates are not published.
 */
export function isBasicPrinting(collector_code: string, collector_number: number) {
  const total = /^[^-]+-\d+\/(\d+)$/.exec(collector_code)?.[1];
  return total !== undefined && collector_number <= Number(total);
}

function inPool(p: PackPrinting, pool: Pool | "Epic"): boolean {
  if (pool === "Any") return true;
  if (pool === "Rune") return p.type === "Rune";
  // Runes are printed as Commons; they come in their own slot.
  return p.rarity === pool && p.type !== "Rune";
}

export interface PackCard<P> {
  printing: P;
  slot: string;
  foil: boolean;
}

/**
 * One pack of `set`, slot by slot as PACK_LAYOUTS has it, from its basic printings only; `rng`
 * returns [0, 1) like Math.random. A slot draws no card twice while it has others; a slot whose
 * pool is empty (a catalogue without that set) is left out. Null for a set without a layout.
 */
export function openPack<P extends PackPrinting>(set: string, printings: P[], rng: () => number): PackCard<P>[] | null {
  const layout = PACK_LAYOUTS[set];
  if (!layout) return null;
  const basic = printings.filter((p) => p.set_code === set && isBasicPrinting(p.collector_code, p.collector_number));
  const pack: PackCard<P>[] = [];
  for (const slot of layout) {
    const drawn = new Set<string>();
    for (let i = 0; i < slot.count; i++) {
      const pool = slot.epic !== undefined && rng() < slot.epic ? "Epic" : slot.pool;
      const all = basic.filter((p) => inPool(p, pool));
      const fresh = all.filter((p) => !drawn.has(p.id));
      const from = fresh.length ? fresh : all;
      if (!from.length) continue;
      const printing = from[Math.floor(rng() * from.length)];
      drawn.add(printing.id);
      pack.push({ printing, slot: slot.label, foil: slot.foil ?? false });
    }
  }
  return pack;
}

/** One opening per member per minute in Discord, so a channel does not flood. */
export const PACK_COOLDOWN_MS = 60_000;

/** Whole seconds until a member may open again after one at `last` (ms), 0 if now. */
export const packWait = (last: number | undefined, now: number) =>
  last === undefined ? 0 : Math.max(0, Math.ceil((last + PACK_COOLDOWN_MS - now) / 1000));
