// Riot printings to OpenRift printings (#333): exact matching only, plus a report of what is
// unmapped and what OpenRift lists that Riot's catalogue has no counterpart for. No I/O: the
// scripts map-cards.ts and map-check.ts do the reading and writing.

import { createHash } from "node:crypto";

/** ni-han-bao's languages and OpenRift's codes for them. KR and TC are out of scope for now. */
export const LANGUAGES = { en: "EN", "zh-Hans": "SC", fr: "FR" } as const;
export type Language = keyof typeof LANGUAGES;
export const FINISHES = ["normal", "foil"] as const;
export type Finish = (typeof FINISHES)[number];
const LANGUAGE_ORDER = Object.keys(LANGUAGES) as Language[];

export type OldPrinting = { id: string; card_id: string; collector_code: string };
export type OldCard = { id: string; name: string };
export type OldCatalogue = { cards: OldCard[]; printings: OldPrinting[] };

export type OpenRiftPrinting = {
  publicCode: string;
  cardId: string;
  finish: string;
  language: string;
  artVariant: string;
  isSigned: boolean;
  isOvernumbered: boolean;
  markers: string[];
  distributionChannels: { channel: string }[];
};
export type OpenRiftCatalogue = {
  cards: Record<string, { slug: string; name: string }>;
  printings: Record<string, OpenRiftPrinting>;
};
export type Source = { url: string; fetched_at: string; etag: string | null; build_id: string | null; sha256: string };

/** The publicCode without OpenRift's language suffix: `RAD-001/167-EN` becomes `RAD-001/167`. */
export function normaliseCode(p: Pick<OpenRiftPrinting, "publicCode" | "language">): { code: string; normalisation: string } {
  const suffix = `-${p.language}`;
  return p.publicCode.endsWith(suffix)
    ? { code: p.publicCode.slice(0, -suffix.length), normalisation: `removed ${suffix}` }
    : { code: p.publicCode, normalisation: "none" };
}

/** What makes a printing not plain; empty for a plain one. */
export function notPlain(p: OpenRiftPrinting): string[] {
  return [
    ...p.markers.map((m) => `marker: ${m}`),
    ...p.distributionChannels.map((d) => `channel: ${d.channel}`),
    ...(p.isSigned ? ["signed"] : []),
  ];
}

export type Candidate = { openrift_id: string; public_code: string; finish: string; language: string; not_plain: string[] };
export type PrintingEntry = {
  printing_id: string;
  finish: Finish;
  language: Language;
  collector_code: string;
} & (
  | { openrift_id: string; openrift_card_id: string; public_code: string; normalisation: string; method: "exact" }
  | { openrift_id: null; unmapped: string; candidates: Candidate[] }
);

type Indexed = { id: string; p: OpenRiftPrinting; code: string; normalisation: string };

function index(or: OpenRiftCatalogue): Indexed[] {
  const languages = new Set<string>(Object.values(LANGUAGES));
  return Object.entries(or.printings)
    .filter(([, p]) => languages.has(p.language))
    .map(([id, p]) => ({ id, p, ...normaliseCode(p) }))
    .sort((a, b) => cmp(a.p.publicCode, b.p.publicCode) || cmp(a.p.language, b.p.language) || cmp(a.p.finish, b.p.finish) || cmp(a.id, b.id));
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const candidate = ({ id, p }: Indexed): Candidate => ({
  openrift_id: id,
  public_code: p.publicCode,
  finish: p.finish,
  language: p.language,
  not_plain: notPlain(p),
});

/** Every (old printing, finish, language) the schema allows, to exactly one plain OpenRift printing or none. */
export function mapPrintings(old: OldCatalogue, or: OpenRiftCatalogue): PrintingEntry[] {
  const byCode = new Map<string, Indexed[]>();
  for (const x of index(or)) byCode.set(x.code, [...(byCode.get(x.code) ?? []), x]);
  const printings = [...old.printings].sort((a, b) => cmp(a.id, b.id));
  return printings.flatMap((o) =>
    FINISHES.flatMap((finish) =>
      LANGUAGE_ORDER.map((language): PrintingEntry => {
        const key = { printing_id: o.id, finish, language, collector_code: o.collector_code };
        const sameCode = byCode.get(o.collector_code) ?? [];
        const inLanguage = sameCode.filter((x) => x.p.language === LANGUAGES[language]);
        const plain = inLanguage.filter((x) => notPlain(x.p).length === 0);
        const matches = plain.filter((x) => x.p.finish === finish);
        if (matches.length === 1) {
          const [{ id, p, normalisation }] = matches;
          return { ...key, openrift_id: id, openrift_card_id: p.cardId, public_code: p.publicCode, normalisation, method: "exact" };
        }
        const unmapped =
          matches.length > 1 ? "several plain printings"
          : !sameCode.length ? "code not in OpenRift"
          : !inLanguage.length ? "code not in OpenRift in this language"
          : !plain.length ? "no plain printing in this language"
          : "no plain printing in this finish";
        return { ...key, openrift_id: null, unmapped, candidates: (matches.length > 1 ? matches : inLanguage).map(candidate) };
      }),
    ),
  );
}

/** Proposed for rows with a printing but no finish or language: EN, `normal` where it exists, else the only finish. */
export type Proposal = { printing_id: string; collector_code: string; openrift_id: string | null; finish: Finish | null; candidates: { finish: Finish; openrift_id: string }[] };

export function propose(entries: PrintingEntry[]): Proposal[] {
  const by = new Map<string, Proposal>();
  for (const e of entries) {
    const p = by.get(e.printing_id) ?? { printing_id: e.printing_id, collector_code: e.collector_code, openrift_id: null, finish: null, candidates: [] };
    by.set(e.printing_id, p);
    if (e.language === "en" && e.openrift_id) p.candidates.push({ finish: e.finish, openrift_id: e.openrift_id });
  }
  for (const p of by.values()) {
    const pick = p.candidates.find((c) => c.finish === "normal") ?? (p.candidates.length === 1 ? p.candidates[0] : undefined);
    if (pick) Object.assign(p, { openrift_id: pick.openrift_id, finish: pick.finish });
  }
  return [...by.values()];
}

export type CardEntry = { card_id: string; name: string } & (
  | { openrift_card_id: string; openrift_slug: string; openrift_name: string }
  | { openrift_card_id: null; unmapped: string; openrift_cards: { openrift_card_id: string; openrift_slug: string; openrift_name: string }[] }
);

/** A Riot card maps when all its mapped printings point at one OpenRift card. */
export function mapCards(old: OldCatalogue, or: OpenRiftCatalogue, entries: PrintingEntry[]): CardEntry[] {
  const cardOf = new Map(old.printings.map((p) => [p.id, p.card_id]));
  const targets = new Map<string, Set<string>>();
  for (const e of entries) {
    if (!e.openrift_id) continue;
    const id = cardOf.get(e.printing_id)!;
    targets.set(id, (targets.get(id) ?? new Set()).add(e.openrift_card_id));
  }
  const describe = (id: string) => ({ openrift_card_id: id, openrift_slug: or.cards[id]?.slug ?? "", openrift_name: or.cards[id]?.name ?? "" });
  return [...old.cards]
    .sort((a, b) => cmp(a.id, b.id))
    .map((c): CardEntry => {
      const ids = [...(targets.get(c.id) ?? [])].sort();
      const key = { card_id: c.id, name: c.name };
      if (ids.length === 1) return { ...key, ...describe(ids[0]) };
      return { ...key, openrift_card_id: null, unmapped: ids.length ? "several OpenRift cards" : "no mapped printing", openrift_cards: ids.map(describe) };
    });
}

export type Conflict = { kind: string; cards: { card_id: string; name: string }[]; openrift: { openrift_card_id: string; openrift_name: string }[] };

/** Cards whose names differ, that split over several OpenRift cards, or that share one. */
export function cardConflicts(cards: CardEntry[]): Conflict[] {
  const out: Conflict[] = [];
  const shared = new Map<string, Extract<CardEntry, { openrift_card_id: string }>[]>();
  for (const c of cards) {
    if (c.openrift_card_id === null) {
      if (c.openrift_cards.length) out.push({ kind: "several OpenRift cards", cards: [c], openrift: c.openrift_cards });
      continue;
    }
    shared.set(c.openrift_card_id, [...(shared.get(c.openrift_card_id) ?? []), c]);
    if (c.name !== c.openrift_name) out.push({ kind: "names differ", cards: [c], openrift: [c] });
  }
  for (const [, cs] of shared) if (cs.length > 1) out.push({ kind: "several Riot cards share one OpenRift card", cards: cs, openrift: [cs[0]] });
  return out.map((c) => ({
    kind: c.kind,
    cards: c.cards.map(({ card_id, name }) => ({ card_id, name })),
    openrift: c.openrift.map(({ openrift_card_id, openrift_name }) => ({ openrift_card_id, openrift_name })),
  }));
}

export type NewListing = { openrift_id: string; public_code: string; language: string; finish: string; name: string; reasons: string[] };

/** OpenRift printings no old combination maps to, each with the reasons its own fields give. */
export function newListings(old: OldCatalogue, or: OpenRiftCatalogue, entries: PrintingEntry[]): NewListing[] {
  const mapped = new Set(entries.flatMap((e) => (e.openrift_id ? [e.openrift_id] : [])));
  const codes = new Set(old.printings.map((p) => p.collector_code));
  const all = index(or);
  const plainKey = (x: Indexed) => `${x.code}|${x.p.language}|${x.p.finish}`;
  const plainCount = new Map<string, number>();
  for (const x of all) if (!notPlain(x.p).length) plainCount.set(plainKey(x), (plainCount.get(plainKey(x)) ?? 0) + 1);
  const languages = new Set<string>(Object.values(LANGUAGES));
  return all
    .filter((x) => !mapped.has(x.id))
    .map((x) => {
      const { p } = x;
      const reasons = [
        ...notPlain(p),
        ...(p.isOvernumbered ? ["overnumbered"] : []),
        ...(p.artVariant !== "normal" ? [`artVariant: ${p.artVariant}`] : []),
        ...((FINISHES as readonly string[]).includes(p.finish) ? [] : ["finish not in old catalogue"]),
        ...(languages.has(p.language) ? [] : ["language not in old catalogue"]),
        ...(codes.has(x.code) ? [] : ["code not in old catalogue"]),
      ];
      if (!reasons.length && plainCount.get(plainKey(x))! > 1) reasons.push("several plain printings with this code, finish and language");
      if (!reasons.length) throw new Error(`${x.id} (${p.publicCode}) is unmapped for no reason in its fields`);
      return { openrift_id: x.id, public_code: p.publicCode, language: p.language, finish: p.finish, name: or.cards[p.cardId]?.name ?? "", reasons };
    });
}

export type ManualResolution = { printing_id: string; finish: Finish; language: Language; openrift_id: string; reason: string };
export type Mapping = { source: Source; printings: PrintingEntry[]; proposed: Proposal[]; cards: CardEntry[]; conflicts: Conflict[]; listings: NewListing[] };

export function buildMapping(old: OldCatalogue, or: OpenRiftCatalogue, source: Source): Mapping {
  const printings = mapPrintings(old, or);
  const cards = mapCards(old, or, printings);
  return { source, printings, proposed: propose(printings), cards, conflicts: cardConflicts(cards), listings: newListings(old, or, printings) };
}

/** JSON with one array element per line, so a diff shows which entries changed. */
function json(top: Record<string, unknown>): string {
  const body = Object.entries(top).map(([k, v]) =>
    `  ${JSON.stringify(k)}: ${Array.isArray(v) ? (v.length ? `[\n${v.map((x) => `    ${JSON.stringify(x)}`).join(",\n")}\n  ]` : "[]") : JSON.stringify(v)}`);
  return `{\n${body.join(",\n")}\n}\n`;
}

const NORMALISATION = 'OpenRift publicCode with its trailing "-<language>" removed (RAD-001/167-EN becomes RAD-001/167), then equal to collector_code';

export function printingMapJson(m: Mapping): string {
  return json({ source: m.source, languages: LANGUAGES, normalisation: NORMALISATION, printings: m.printings, proposed_without_finish_or_language: m.proposed });
}

export function cardMapJson(m: Mapping): string {
  return json({ source: m.source, cards: m.cards });
}

const cell = (s: string) => s.replace(/\|/g, "\\|");
function countBy<T>(xs: T[], keys: (x: T) => string[]): [string, number][] {
  const n = new Map<string, number>();
  for (const x of xs) for (const k of keys(x)) n.set(k, (n.get(k) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
}

export function report(m: Mapping, riot: { source: string; fetched_at: string }): string {
  const mapped = m.printings.filter((e) => e.openrift_id);
  const unmapped = m.printings.filter((e): e is Extract<PrintingEntry, { openrift_id: null }> => !e.openrift_id);
  const perLanguage = (es: PrintingEntry[]) => LANGUAGE_ORDER.map((l) => es.filter((e) => e.language === l).length).join(" | ");
  const cardsMapped = m.cards.filter((c) => c.openrift_card_id).length;
  const proposed = m.proposed.filter((p) => p.openrift_id).length;
  const byReason = countBy(m.listings, (l) => l.reasons);
  const out = [
    "# Riot printings to OpenRift",
    "",
    "Generated by `pnpm --filter ni-han-bao-bot cards:map` (#333). Do not edit by hand.",
    "",
    "## Source",
    "",
    `- OpenRift: ${m.source.url}, fetched ${m.source.fetched_at}, ETag \`${m.source.etag ?? "none"}\`, X-Build-Id \`${m.source.build_id ?? "none"}\`, sha256 \`${m.source.sha256}\``,
    `- Riot: ${riot.source}, fetched ${riot.fetched_at} (\`bot/riftbound-cards.json\`)`,
    `- Languages: ${LANGUAGE_ORDER.map((l) => `\`${l}\` is \`${LANGUAGES[l]}\``).join(", ")}. KR and TC are out of scope.`,
    `- Code normalisation: ${NORMALISATION}.`,
    "- A match is exact: same code, plain (no markers, no distribution channels, not signed), same finish and language, and exactly one such OpenRift printing.",
    "",
    "## Counts",
    "",
    `| | ${LANGUAGE_ORDER.join(" | ")} |`,
    `|---|${LANGUAGE_ORDER.map(() => "--:").join("|")}|`,
    `| Mapped (old printing × finish × language) | ${perLanguage(mapped)} |`,
    ...countBy(unmapped, (e) => [e.unmapped]).map(([r]) => `| Unmapped: ${r} | ${perLanguage(unmapped.filter((e) => e.unmapped === r))} |`),
    "",
    `Cards: ${cardsMapped} of ${m.cards.length} map to one OpenRift card. Without finish or language, ${proposed} of ${m.proposed.length} old printings have a proposed printing.`,
    "",
    `New listings: ${m.listings.length} OpenRift printings no old combination maps to. A printing with several reasons counts under each.`,
    "",
    "| Reason | Printings |",
    "|---|--:|",
    ...byReason.map(([r, n]) => `| ${cell(r)} | ${n} |`),
    "",
    "## Unmapped",
    "",
    "| Old printing | Code | Finish | Language | Reason | Candidates |",
    "|---|---|---|---|---|---|",
    ...unmapped.map((e) =>
      `| ${e.printing_id} | ${cell(e.collector_code)} | ${e.finish} | ${e.language} | ${e.unmapped} | ${e.candidates.map((c) => `${cell(c.public_code)} ${c.finish}${c.not_plain.length ? ` (${c.not_plain.join(", ")})` : ""} \`${c.openrift_id}\``).join("<br>")} |`),
    "",
    "## New printings, by reason",
    ...byReason.flatMap(([r]) => [
      "",
      `### ${r}`,
      "",
      "| Code | Language | Finish | Card | OpenRift id |",
      "|---|---|---|---|---|",
      ...m.listings.filter((l) => l.reasons.includes(r)).map((l) => `| ${cell(l.public_code)} | ${l.language} | ${l.finish} | ${cell(l.name)} | \`${l.openrift_id}\` |`),
    ]),
    "",
    "## Unmapped cards",
    "",
    ...m.cards.flatMap((c) => (c.openrift_card_id === null ? [`- ${c.name} (\`${c.card_id}\`): ${c.unmapped}`] : [])),
    "",
    "## Card conflicts",
    "",
    "| Conflict | Riot | OpenRift |",
    "|---|---|---|",
    ...m.conflicts.map((c) =>
      `| ${c.kind} | ${c.cards.map((x) => `${cell(x.name)} (\`${x.card_id}\`)`).join("<br>")} | ${c.openrift.map((x) => `${cell(x.openrift_name)} (\`${x.openrift_card_id}\`)`).join("<br>")} |`),
    "",
    "## Proposed: rows without finish or language",
    "",
    "`riftbound_deck_cards`, the wishlist and the deck legend and champion printings carry a printing but no finish or language. **Proposed, for review, not applied:** EN, `normal` where it exists, else the only finish. Candidates are the EN printings mapped above.",
    "",
    "| Old printing | Code | EN candidates | Proposed |",
    "|---|---|---|---|",
    ...m.proposed.map((p) =>
      `| ${p.printing_id} | ${cell(p.collector_code)} | ${p.candidates.map((c) => c.finish).join(", ") || "none"} | ${p.openrift_id ? `${p.finish} \`${p.openrift_id}\`` : "none"} |`),
    "",
  ];
  return out.join("\n");
}

/** The committed outputs, by path from bot/, from the committed inputs' contents. */
export function mapFiles(cards: string, snapshot: Buffer, snapshotManifest: string, riotManifest: string): Record<string, string> {
  const source = JSON.parse(snapshotManifest) as Source;
  const sha = createHash("sha256").update(snapshot).digest("hex");
  if (sha !== source.sha256) throw new Error(`openrift-catalog.json has sha256 ${sha}, its manifest says ${source.sha256}`);
  const m = buildMapping(JSON.parse(cards), JSON.parse(snapshot.toString("utf8")), source);
  return {
    "riftbound-printing-map.json": printingMapJson(m),
    "riftbound-card-map.json": cardMapJson(m),
    "../docs/openrift-mapping.md": report(m, JSON.parse(riotManifest)),
  };
}

export type Lookup = { exact: Set<string>; manual: Set<string>; proposed: Set<string>; cards: Set<string> };
export const tripleKey = (printing: string, finish: string, language: string) => `${printing}|${finish}|${language}`;

export function lookup(printingMap: { printings: PrintingEntry[]; proposed_without_finish_or_language: Proposal[] }, cardMap: { cards: CardEntry[] }, manual: ManualResolution[]): Lookup {
  return {
    exact: new Set(printingMap.printings.filter((e) => e.openrift_id).map((e) => tripleKey(e.printing_id, e.finish, e.language))),
    manual: new Set(manual.map((e) => tripleKey(e.printing_id, e.finish, e.language))),
    proposed: new Set(printingMap.proposed_without_finish_or_language.filter((p) => p.openrift_id).map((p) => p.printing_id)),
    cards: new Set(cardMap.cards.filter((c) => c.openrift_card_id).map((c) => c.card_id)),
  };
}

/** A referenced value: a card id, a printing id, or a printing with its finish and language. */
export type Reference = { card?: string; printing?: string; finish?: string; language?: string };

/** The references with no mapping: a triple needs an exact or manual entry, a bare printing the proposed rule. */
export function unmappedReferences(refs: Reference[], l: Lookup): Reference[] {
  return refs.filter((r) => {
    if (r.card !== undefined) return !l.cards.has(r.card);
    if (r.finish !== undefined && r.language !== undefined) {
      const k = tripleKey(r.printing!, r.finish, r.language);
      return !l.exact.has(k) && !l.manual.has(k);
    }
    return !l.proposed.has(r.printing!);
  });
}
