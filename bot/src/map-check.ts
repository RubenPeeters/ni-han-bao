// By hand, before the OpenRift migration (#333): `DATABASE_URL=<read-only url> pnpm --filter
// ni-han-bao-bot cards:map-check`. Lists every card id, printing id and (printing, finish,
// language) that user data references, per foreign key to the catalogue, and which of them the
// committed maps do not cover. Reads only: psql, in read-only transactions.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { lookup, unmappedReferences, type Reference } from "./openrift-map.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("set DATABASE_URL to a read-only connection string");

const query = (sql: string): unknown =>
  JSON.parse(execFileSync("psql", [url, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
    env: { ...process.env, PGOPTIONS: "-c default_transaction_read_only=on" },
    maxBuffer: 1 << 28,
  }));

// Each referencing column, its catalogue table, and whether its row has a finish and a language.
// The catalogue's own key (riftbound_printings.card_id) is left out: it is what gets replaced.
const keys = query(`
  select coalesce(json_agg(json_build_object(
      'schema', k.table_schema, 'table', k.table_name, 'column', k.column_name, 'ref', r.table_name,
      'finish_language', (select count(*) = 2 from information_schema.columns c
        where c.table_schema = k.table_schema and c.table_name = k.table_name and c.column_name in ('finish', 'language')))
    order by k.table_name, k.column_name), '[]')
  from information_schema.referential_constraints rc
  join information_schema.key_column_usage k
    on k.constraint_schema = rc.constraint_schema and k.constraint_name = rc.constraint_name
  join information_schema.key_column_usage r
    on r.constraint_schema = rc.unique_constraint_schema and r.constraint_name = rc.unique_constraint_name
    and r.ordinal_position = k.position_in_unique_constraint
  where r.table_schema = 'public' and r.table_name in ('riftbound_printings', 'riftbound_cards') and r.column_name = 'id'
    and k.table_name not in ('riftbound_printings', 'riftbound_cards')`) as { schema: string; table: string; column: string; ref: string; finish_language: boolean }[];
// information_schema hides constraints on tables the role cannot write to: none found means the role sees too little.
if (!keys.length) throw new Error("information_schema shows no foreign keys to the catalogue: does this role have more than SELECT on the tables?");

const bot = new URL("../", import.meta.url);
const read = (f: string) => JSON.parse(readFileSync(new URL(f, bot), "utf8"));
const maps = lookup(read("riftbound-printing-map.json"), read("riftbound-card-map.json"), read("riftbound-printing-map.manual.json").resolutions);

let missing = 0;
for (const k of keys) {
  const id = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const col = id(k.column);
  const triple = k.ref === "riftbound_printings" && k.finish_language;
  const fields = k.ref === "riftbound_cards" ? `'card', ${col}` : triple ? `'printing', ${col}, 'finish', finish, 'language', language` : `'printing', ${col}`;
  const refs = query(`select coalesce(json_agg(r order by r::text), '[]') from (select distinct json_build_object(${fields})::jsonb as r
    from ${id(k.schema)}.${id(k.table)} where ${col} is not null) x`) as Reference[];
  const unmapped = new Set(unmappedReferences(refs, maps));
  missing += unmapped.size;
  console.log(`${k.table}.${k.column}${triple ? " (with finish, language)" : ""}: ${refs.length} distinct, ${unmapped.size} without a mapping`);
  for (const r of refs) console.log(`  ${[r.card ?? r.printing, r.finish, r.language].filter(Boolean).join(" ")}${unmapped.has(r) ? "  NO MAPPING" : ""}`);
}
console.log(`${missing} referenced values without a mapping`);
