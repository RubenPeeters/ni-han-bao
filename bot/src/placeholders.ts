// By hand, when Data Dragon has new champions: `pnpm --filter ni-han-bao-bot placeholders`.
// Writes the placeholder catalogue (bot/riftbound-catalogue.json, which the bot loads on
// start), the spell and gear art (public/riftbound/) and the copy in supabase/seed.sql for
// the dev database. Commit the result; the same champions give byte-identical files.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { catalogueJson, placeholderCatalogue, placeholderSvg, type Champion } from "./riftbound.js";

const DDRAGON = "https://ddragon.leagueoflegends.com";
const root = new URL("../../", import.meta.url);

const [version] = (await (await fetch(`${DDRAGON}/api/versions.json`)).json()) as string[];
const { data } = (await (await fetch(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`)).json()) as {
  data: Record<string, Champion>;
};
const catalogue = placeholderCatalogue(Object.values(data));
const json = catalogueJson(catalogue);
writeFileSync(new URL("bot/riftbound-catalogue.json", root), json);

mkdirSync(new URL("public/riftbound/", root), { recursive: true });
for (const card of catalogue.cards.filter((c) => c.type === "Spell" || c.type === "Gear")) {
  writeFileSync(new URL(`public/riftbound/${card.id}.svg`, root), placeholderSvg(card));
}

const seed = new URL("supabase/seed.sql", root);
const block = /(-- BEGIN riftbound catalogue\n)[\s\S]*?(-- END riftbound catalogue\n)/;
const sql = readFileSync(seed, "utf8");
if (!block.test(sql)) throw new Error("supabase/seed.sql has no riftbound catalogue markers");
writeFileSync(seed, sql.replace(block, (_, begin, end) =>
  `${begin}select private.load_riftbound_catalogue($catalogue$\n${json}$catalogue$::jsonb);\n${end}`));

console.log(`${catalogue.cards.length} placeholder cards from Data Dragon ${version}`);
