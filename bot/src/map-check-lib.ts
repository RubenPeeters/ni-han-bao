// The pure half of map-check.ts (#333): the catalogue queries and the lookup in the committed maps.

export type ForeignKey = { table: string; column: string; target: "riftbound_printings" | "riftbound_cards"; finish_and_language: boolean };

// pg_catalog rather than information_schema: information_schema.referential_constraints only
// shows constraints on tables the role may write to, so a read-only role would see none.
export const FOREIGN_KEYS_SQL = `
select coalesce(json_agg(r order by r."table", r."column"), '[]') from (
  select c.conrelid::regclass::text as "table", a.attname as "column", t.relname as target,
    (select count(*) from pg_attribute x where x.attrelid = c.conrelid and not x.attisdropped
       and x.attname in ('finish', 'language')) = 2 as finish_and_language
  from pg_constraint c
  join pg_class t on t.oid = c.confrelid
  join pg_namespace n on n.oid = t.relnamespace
  cross join lateral unnest(c.conkey, c.confkey) as k(src, dst)
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.src
  join pg_attribute d on d.attrelid = c.confrelid and d.attnum = k.dst
  where c.contype = 'f' and n.nspname = 'public' and t.relname in ('riftbound_printings', 'riftbound_cards')
    and d.attname = 'id' and c.conrelid not in ('public.riftbound_printings'::regclass, 'public.riftbound_cards'::regclass)
) r`;

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`;

// `table` is already quoted by regclass::text.
export function referencesSql(fk: ForeignKey): string {
  const col = ident(fk.column);
  const value = fk.target === "riftbound_printings" && fk.finish_and_language ? `jsonb_build_array(${col}, finish, language::text)` : col;
  return `select coalesce(json_agg(distinct ${value}), '[]') from ${fk.table} where ${col} is not null`;
}

type Maps = {
  printing: {
    printings: { old: string; finish: string; language: string; openrift: string | null }[];
    without_finish_or_language: { old: string; proposed: string | null }[];
  };
  card: { cards: { old: string; openrift: string | null }[] };
};

export function checkReferences(fk: ForeignKey, refs: (string | string[])[], maps: Maps) {
  const [kind, lookup] = fk.target === "riftbound_cards"
    ? ["card", new Map(maps.card.cards.map((c) => [c.old, c.openrift]))] as const
    : fk.finish_and_language
      ? ["printing × finish × language", new Map(maps.printing.printings.map((p) => [`${p.old} ${p.finish} ${p.language}`, p.openrift]))] as const
      : ["printing, proposed rule", new Map(maps.printing.without_finish_or_language.map((p) => [p.old, p.proposed]))] as const;
  const unmapped = refs
    .map((r) => (Array.isArray(r) ? r.join(" ") : r))
    .filter((r) => !lookup.get(r))
    .map((r) => (lookup.has(r) ? r : `${r} (not in the map)`))
    .sort();
  return { kind, referenced: refs.length, unmapped };
}
