// By hand, before the OpenRift migration (#333): `DATABASE_URL=<read-only url>
// pnpm --filter ni-han-bao-bot cards:map-check`. Lists every printing (with finish and language
// where the table has them) and card id that rows actually reference, per foreign key to
// riftbound_printings or riftbound_cards, and which have no mapping in the committed maps.
// Reads only (a read-only transaction through psql); exits 1 when something has no mapping.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkReferences, FOREIGN_KEYS_SQL, referencesSql, type ForeignKey } from "./map-check-lib.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("set DATABASE_URL (a read-only connection string)");
const query = (sql: string): unknown => JSON.parse(execFileSync("psql", [url, "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], {
  encoding: "utf8",
  maxBuffer: 1 << 28,
  env: { ...process.env, PGOPTIONS: "-c default_transaction_read_only=on" },
}));

const bot = new URL("../", import.meta.url);
const maps = {
  printing: JSON.parse(readFileSync(fileURLToPath(new URL("riftbound-printing-map.json", bot)), "utf8")),
  card: JSON.parse(readFileSync(fileURLToPath(new URL("riftbound-card-map.json", bot)), "utf8")),
};

const fks = query(FOREIGN_KEYS_SQL) as ForeignKey[];
if (!fks.length) throw new Error("no foreign keys to riftbound_printings or riftbound_cards found");
let missing = 0;
for (const fk of fks) {
  const result = checkReferences(fk, query(referencesSql(fk)) as (string | string[])[], maps);
  missing += result.unmapped.length;
  console.log(`${fk.table}.${fk.column} (${result.kind}): ${result.referenced} referenced, ${result.unmapped.length} without mapping`);
  for (const u of result.unmapped) console.log(`  ${u}`);
}
process.exitCode = missing ? 1 : 0;
