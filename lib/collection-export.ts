// Collection export (#293): pure, so both formats are tested against their readers without a browser.

export interface ExportCard {
  id: string;
  name: string;
  type: string;
  tags: string[];
}

export interface ExportPrinting {
  id: string;
  card_id: string;
  set_code: string;
  rarity: string | null;
}

/** A riftbound_collection row: one printing at one finish, condition and language. */
export interface ExportRow {
  printing_id: string;
  quantity: number;
}

/** Copies per key, summed over the rows that share it, in key order. */
function sum(rows: ExportRow[], key: (r: ExportRow) => string | undefined) {
  const out = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (k !== undefined) out.set(k, (out.get(k) ?? 0) + r.quantity);
  }
  return out;
}

// deckText()'s headings (bot/src/deck-match.ts), less Champion and Sideboard: a collection has neither.
const BLOCKS = [
  { heading: "Legend", type: (t: string) => t === "Legend" },
  { heading: "Main deck", type: (t: string) => !["Legend", "Rune", "Battlefield"].includes(t) },
  { heading: "Runes", type: (t: string) => t === "Rune" },
  { heading: "Battlefields", type: (t: string) => t === "Battlefield" },
];

/** The collection as a list parseDeckList() reads back: "N Card Name", copies summed over every printing. */
export function collectionDeckList(rows: ExportRow[], printings: Map<string, ExportPrinting>, cards: Map<string, ExportCard>): string {
  const copies = sum(rows, (r) => printings.get(r.printing_id)?.card_id);
  const owned = [...copies.keys()].flatMap((id) => cards.get(id) ?? []);
  // A legend by champion and epithet, as deckText() writes it: the epithet alone may be another card's name.
  const name = (c: ExportCard) => (c.type === "Legend" ? [...c.tags.slice(0, 1), c.name].join(", ") : c.name);
  return BLOCKS.map(({ heading, type }) => [
    heading,
    owned
      .filter((c) => type(c.type))
      .map((c) => ({ c, name: name(c) }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ c, name }) => `${copies.get(c.id)} ${name}`),
  ] as const)
    .filter(([, lines]) => lines.length)
    .map(([heading, lines]) => [`${heading}:`, ...lines].join("\n"))
    .join("\n\n");
}

export const CSV_HEADER = ["card_id", "name", "set_code", "type", "rarity", "quantity", "want_quantity"];

const field = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

/** The collection as a CSV parseCollectionCsv() reads back: one row per printing, every field quoted (RFC 4180). */
export function collectionCsv(rows: ExportRow[], printings: Map<string, ExportPrinting>, cards: Map<string, ExportCard>): string {
  const copies = sum(rows, (r) => r.printing_id);
  const lines = [...copies.keys()].sort().map((id) => {
    const p = printings.get(id);
    const c = p && cards.get(p.card_id);
    // The wishlist is not part of the collection.
    return [id, c?.name ?? "", p?.set_code ?? "", c?.type ?? "", p?.rarity ?? "", copies.get(id)!, 0].map(field).join(",");
  });
  return [CSV_HEADER.join(","), ...lines].map((l) => `${l}\r\n`).join("");
}
