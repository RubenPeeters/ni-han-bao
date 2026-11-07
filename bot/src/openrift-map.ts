// Maps the committed Riot catalogue onto OpenRift's printings (#333), exactly: same collector
// code, a plain printing, same finish and language, and only one of them. Pure, so the same two
// inputs always give byte-identical files; the fetch and the file writes are in map-cards.ts.

export const FINISHES = ["normal", "foil"] as const;
export type Finish = (typeof FINISHES)[number];
// ni-han-bao's languages (the riftbound_language domain) and OpenRift's codes for them.
export const LANGUAGES = { en: "EN", "zh-Hans": "SC", fr: "FR" } as const;
export type Language = keyof typeof LANGUAGES;
const LANGUAGE_ORDER = Object.keys(LANGUAGES) as Language[];
const OPENRIFT_LANGUAGES: readonly string[] = Object.values(LANGUAGES);

export type RiotCatalogue = {
  cards: { id: string; name: string }[];
  printings: { id: string; card_id: string; collector_code: string }[];
};

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

export type OpenRiftCatalog = {
  cards: Record<string, { slug: string; name: string }>;
  printings: Record<string, OpenRiftPrinting>;
};

export type ManualEntry = { old: string; finish: Finish; language: Language; openrift: string; reason: string };

export const UNMAPPED = {
  noCode: "code not in OpenRift",
  noLanguage: "code not in OpenRift in this language",
  noPlain: "no plain printing in this finish",
  several: "several plain printings",
} as const;

export type PrintingEntry = { old: string; finish: Finish; language: Language } & (
  | { openrift: string; method: "exact" | "manual"; reason?: string }
  | { openrift: null; reason: string; candidates: string[] }
);

export type CardEntry = { old: string; name: string } & (
  | { openrift: string; slug: string; openrift_name: string }
  | { openrift: null; reason: string; candidates: { id: string; slug: string; name: string }[] }
);

// Rows that store a printing but no finish or language (deck cards, the wishlist, deck legend and
// champion printings): what the proposed rule would pick, not applied anywhere yet.
export type ProposedEntry = { old: string; proposed: string | null; finish: Finish | null; candidates: string[] };

export type NewListing = { id: string; reasons: string[] };

export const NORMALISATION = 'OpenRift\'s publicCode with a trailing "-<its language>" removed ("RAD-001/167-EN" becomes "RAD-001/167"); nothing else is changed.';
export const PROPOSED_RULE = "EN, `normal` where it maps, else the only finish that maps (foil).";

export function normaliseCode(publicCode: string, language: string): string {
  const suffix = `-${language}`;
  return publicCode.endsWith(suffix) ? publicCode.slice(0, -suffix.length) : publicCode;
}

export function isPlain(p: OpenRiftPrinting): boolean {
  return p.markers.length === 0 && p.distributionChannels.length === 0 && !p.isSigned;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const key = (old: string, finish: string, language: string) => `${old}|${finish}|${language}`;

// OpenRift's printings in the three languages, by normalised code, in id order.
function byCode(catalog: OpenRiftCatalog): Map<string, [string, OpenRiftPrinting][]> {
  const index = new Map<string, [string, OpenRiftPrinting][]>();
  for (const [id, p] of Object.entries(catalog.printings).sort(([a], [b]) => cmp(a, b))) {
    if (!OPENRIFT_LANGUAGES.includes(p.language)) continue;
    const code = normaliseCode(p.publicCode, p.language);
    index.set(code, [...(index.get(code) ?? []), [id, p]]);
  }
  return index;
}

export function matchPrinting(
  old: { id: string; collector_code: string },
  finish: Finish,
  language: Language,
  index: Map<string, [string, OpenRiftPrinting][]>,
): PrintingEntry {
  const sameCode = index.get(old.collector_code) ?? [];
  const sameLanguage = sameCode.filter(([, p]) => p.language === LANGUAGES[language]);
  const matches = sameLanguage.filter(([, p]) => isPlain(p) && p.finish === finish);
  const base = { old: old.id, finish, language };
  if (matches.length === 1) return { ...base, openrift: matches[0][0], method: "exact" };
  const reason = matches.length > 1 ? UNMAPPED.several
    : !sameCode.length ? UNMAPPED.noCode : !sameLanguage.length ? UNMAPPED.noLanguage : UNMAPPED.noPlain;
  return { ...base, openrift: null, reason, candidates: (matches.length > 1 ? matches : sameLanguage).map(([id]) => id) };
}

export function validateManual(raw: unknown): ManualEntry[] {
  const entries = (raw as { entries?: unknown })?.entries;
  if (!Array.isArray(entries)) throw new Error("manual map: no entries array");
  for (const e of entries) {
    const ok = e && typeof e.old === "string" && FINISHES.includes(e.finish) && e.language in LANGUAGES
      && typeof e.openrift === "string" && typeof e.reason === "string" && e.reason.trim() !== "";
    if (!ok) throw new Error(`manual map: bad entry ${JSON.stringify(e)}`);
  }
  return entries as ManualEntry[];
}

export function newReasons(p: OpenRiftPrinting, oldCodes: Set<string>, oldLanguages: Set<string>, duplicates: Set<string>, id: string): string[] {
  const reasons = [
    ...p.markers.map((m) => `marker: ${m}`),
    ...(p.isSigned ? ["signed"] : []),
    ...(p.isOvernumbered ? ["overnumbered"] : []),
    ...p.distributionChannels.map((c) => `channel: ${c.channel}`),
    ...(p.artVariant !== "normal" ? [`art variant: ${p.artVariant}`] : []),
    ...(!(FINISHES as readonly string[]).includes(p.finish) ? ["finish not in old catalogue"] : []),
    ...(!oldLanguages.has(p.language) ? ["language not in old catalogue"] : []),
    ...(!oldCodes.has(normaliseCode(p.publicCode, p.language)) ? ["code not in old catalogue"] : []),
    ...(duplicates.has(id) ? ["one of several plain printings"] : []),
  ];
  return reasons.length ? reasons : ["no reason found"];
}

export function buildMaps(riot: RiotCatalogue, catalog: OpenRiftCatalog, manual: ManualEntry[]) {
  const index = byCode(catalog);
  const olds = [...riot.printings].sort((a, b) => cmp(a.id, b.id));
  const printings: PrintingEntry[] = olds.flatMap((old) =>
    FINISHES.flatMap((finish) => LANGUAGE_ORDER.map((language) => matchPrinting(old, finish, language, index))));

  const byKey = new Map(printings.map((e, i) => [key(e.old, e.finish, e.language), i]));
  for (const m of manual) {
    const i = byKey.get(key(m.old, m.finish, m.language));
    if (i === undefined) throw new Error(`manual map: ${m.old} ${m.finish} ${m.language} is not an old combination`);
    if (printings[i].openrift) throw new Error(`manual map: ${m.old} ${m.finish} ${m.language} already maps exactly`);
    if (!catalog.printings[m.openrift]) throw new Error(`manual map: ${m.openrift} is not an OpenRift printing`);
    printings[i] = { old: m.old, finish: m.finish, language: m.language, openrift: m.openrift, method: "manual", reason: m.reason };
  }

  const oldCard = new Map(riot.printings.map((p) => [p.id, p.card_id]));
  const targets = new Map<string, Set<string>>();
  for (const e of printings) {
    if (!e.openrift) continue;
    const card = oldCard.get(e.old)!;
    targets.set(card, (targets.get(card) ?? new Set()).add(catalog.printings[e.openrift].cardId));
  }
  const cards: CardEntry[] = [...riot.cards].sort((a, b) => cmp(a.id, b.id)).map(({ id, name }) => {
    const ids = [...(targets.get(id) ?? [])].sort(cmp);
    if (ids.length === 1) return { old: id, name, openrift: ids[0], slug: catalog.cards[ids[0]].slug, openrift_name: catalog.cards[ids[0]].name };
    if (!ids.length) return { old: id, name, openrift: null, reason: "no mapped printing", candidates: [] };
    return { old: id, name, openrift: null, reason: "printings map to several OpenRift cards",
      candidates: ids.map((c) => ({ id: c, slug: catalog.cards[c].slug, name: catalog.cards[c].name })) };
  });

  const mapped = new Map(printings.filter((e) => e.openrift).map((e) => [key(e.old, e.finish, e.language), e.openrift!]));
  const proposed: ProposedEntry[] = olds.map((old) => {
    const normal = mapped.get(key(old.id, "normal", "en"));
    const foil = mapped.get(key(old.id, "foil", "en"));
    const candidates = [normal, foil].filter((c): c is string => !!c);
    return { old: old.id, proposed: normal ?? foil ?? null, finish: normal ? "normal" : foil ? "foil" : null, candidates };
  });

  const used = new Set(mapped.values());
  const oldCodes = new Set(riot.printings.map((p) => p.collector_code));
  const oldLanguages = new Set(LANGUAGE_ORDER.map((l) => LANGUAGES[l]));
  const duplicates = new Set(printings.flatMap((e) => (e.openrift === null && e.reason === UNMAPPED.several ? e.candidates : [])));
  const newListings: NewListing[] = Object.entries(catalog.printings)
    .filter(([id, p]) => OPENRIFT_LANGUAGES.includes(p.language) && !used.has(id))
    .sort(([a], [b]) => cmp(a, b))
    .map(([id, p]) => ({ id, reasons: newReasons(p, oldCodes, oldLanguages, duplicates, id) }));

  return { printings, cards, proposed, newListings };
}

export type Maps = ReturnType<typeof buildMaps>;
export type Source = { url: string; fetchedAt: string; etag: string | null; buildId: string | null; sha256: string };

// One entry per line, like riftbound-cards.json: diffs stay readable.
const lines = (rows: unknown[]) => rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n");

export function printingMapJson(maps: Maps, source: Source): string {
  return `{\n  "source": ${JSON.stringify(source)},\n  "normalisation": ${JSON.stringify(NORMALISATION)},\n`
    + `  "printings": [\n${lines(maps.printings)}\n  ],\n`
    + `  "proposed_rule": ${JSON.stringify(PROPOSED_RULE)},\n  "without_finish_or_language": [\n${lines(maps.proposed)}\n  ]\n}\n`;
}

export function cardMapJson(maps: Maps, source: Source): string {
  return `{\n  "source": ${JSON.stringify(source)},\n  "cards": [\n${lines(maps.cards)}\n  ]\n}\n`;
}

function countBy(items: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => cmp(a, b));
}

export function report(maps: Maps, catalog: OpenRiftCatalog, source: Source): string {
  const describe = (id: string) => {
    const p = catalog.printings[id];
    const extra = [...p.markers, ...p.distributionChannels.map((c) => c.channel), ...(p.isSigned ? ["signed"] : [])];
    return `\`${id}\` ${p.publicCode} ${p.language} ${p.finish}${extra.length ? ` (${extra.join(", ")})` : ""}`;
  };
  const unmapped = maps.printings.filter((e): e is Extract<PrintingEntry, { openrift: null }> => !e.openrift);
  const mapped = maps.printings.filter((e) => e.openrift);
  const newReasonList = maps.newListings.flatMap((n) => n.reasons);
  const out: string[] = [
    "# Riot printings mapped to OpenRift",
    "",
    "Generated by `pnpm --filter ni-han-bao-bot cards:map` (#333). Do not edit by hand.",
    "",
    `- Source: ${source.url}`,
    `- Fetched: ${source.fetchedAt}`,
    `- ETag: ${source.etag ?? "none"}; X-Build-Id: ${source.buildId ?? "none"}; sha256: ${source.sha256}`,
    `- Code normalisation: ${NORMALISATION}`,
    "- Plain: no `markers`, no `distributionChannels`, not `isSigned`.",
    "",
    "## Counts",
    "",
    `Old combinations (printing × finish × language): ${maps.printings.length}.`,
    "",
    ...countBy(mapped.map((e) => `mapped, ${e.openrift && e.method}`)).map(([k, n]) => `- ${k}: ${n}`),
    ...countBy(unmapped.map((e) => `unmapped, ${e.reason}`)).map(([k, n]) => `- ${k}: ${n}`),
    "",
    `Cards: ${maps.cards.filter((c) => c.openrift).length} mapped, ${maps.cards.filter((c) => !c.openrift).length} not.`,
    "",
    `New listings (OpenRift printings in EN, SC and FR no old combination maps to): ${maps.newListings.length}. By reason (a printing can have several):`,
    "",
    ...countBy(newReasonList).map(([k, n]) => `- ${k}: ${n}`),
    "",
    "## Unmapped combinations",
    "",
  ];
  for (const [reason] of countBy(unmapped.map((e) => e.reason))) {
    out.push(`### ${reason}`, "");
    for (const e of unmapped.filter((u) => u.reason === reason)) {
      out.push(`- ${e.old} ${e.finish} ${e.language}${e.candidates.length ? `: ${e.candidates.map(describe).join("; ")}` : ""}`);
    }
    out.push("");
  }
  out.push("## Card conflicts", "");
  for (const c of maps.cards) {
    if (c.openrift === null && c.candidates.length) out.push(`- ${c.old} (${c.name}): ${c.reason}: ${c.candidates.map((o) => `${o.slug} (${o.name})`).join("; ")}`);
    if (c.openrift && c.name !== c.openrift_name) out.push(`- ${c.old}: names differ: Riot "${c.name}", OpenRift "${c.openrift_name}" (${c.slug})`);
  }
  for (const c of maps.cards) if (c.openrift === null && !c.candidates.length) out.push(`- ${c.old} (${c.name}): ${c.reason}`);
  out.push(
    "",
    "## Proposed: rows without finish or language",
    "",
    "`riftbound_deck_cards`, the wishlist, and deck legend and champion printings store a printing but no finish or language.",
    `**Proposed rule, for review, not applied:** ${PROPOSED_RULE} The candidates per old printing are in \`bot/riftbound-printing-map.json\` (\`without_finish_or_language\`).`,
    "",
    ...countBy(maps.proposed.map((p) => p.finish ?? "no proposal")).map(([k, n]) => `- ${k}: ${n}`),
    "",
    "Old printings the rule gives no printing for, or only foil:",
    "",
    ...maps.proposed.filter((p) => p.finish !== "normal").map((p) => `- ${p.old}: ${p.proposed ? `proposed (foil) ${describe(p.proposed)}` : "no proposal"}`),
    "",
    "## New listings by reason",
    "",
  );
  for (const [reason] of countBy(newReasonList)) {
    out.push(`### ${reason}`, "");
    for (const n of maps.newListings.filter((l) => l.reasons.includes(reason))) {
      out.push(`- ${describe(n.id)}, ${catalog.cards[catalog.printings[n.id].cardId]?.name ?? "unknown card"}`);
    }
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

// The three committed outputs from the committed inputs; the reproducibility test calls this too.
export function derive(riot: RiotCatalogue, catalog: OpenRiftCatalog, source: Source, manual: unknown) {
  const maps = buildMaps(riot, catalog, validateManual(manual));
  return { printingMap: printingMapJson(maps, source), cardMap: cardMapJson(maps, source), report: report(maps, catalog, source) };
}
