// By hand, when Riot publishes cards: `pnpm --filter ni-han-bao-bot cards`. Writes the real
// card data (bot/riftbound-cards.json), where it came from (bot/riftbound-cards.manifest.json)
// and the copy in supabase/seed.sql for the dev database. Commit all three; the same feed gives
// byte-identical files. Production's catalogue changes only through Accept (#204).
import { readFileSync, writeFileSync } from "node:fs";
import { findingText, symbolFindings } from "./riftbound-checks.js";
import { CORRECTIONS, cardsJson, feedItems, fetchFeed, manifest, transformFeed } from "./riftbound-feed.js";

const bot = new URL("../", import.meta.url);

const fetchedAt = new Date();
const { url, buildId, feed } = await fetchFeed();
const catalogue = transformFeed(feedItems(feed), CORRECTIONS);
// The domain symbols of printings new to the committed catalogue (#324): all of them on demand, with cards:check-images.
const committed = new Set((JSON.parse(readFileSync(new URL("riftbound-cards.json", bot), "utf8")) as { printings: { id: string }[] }).printings.map((p) => p.id));
catalogue.findings.push(...(await symbolFindings(catalogue.cards, catalogue.printings.filter((p) => !committed.has(p.id)))));
const json = cardsJson(catalogue);
writeFileSync(new URL("riftbound-cards.json", bot), json);
writeFileSync(new URL("riftbound-cards.manifest.json", bot), manifest(catalogue, json, { url, buildId, fetchedAt }));

const seed = new URL("../supabase/seed.sql", bot);
const block = /(-- BEGIN riftbound catalogue\n)[\s\S]*?(-- END riftbound catalogue\n)/;
const sql = readFileSync(seed, "utf8");
if (!block.test(sql)) throw new Error("supabase/seed.sql has no riftbound catalogue markers");
writeFileSync(seed, sql.replace(block, (_, begin, end) =>
  `${begin}select private.load_riftbound_catalogue($catalogue$\n${json}$catalogue$::jsonb);\n${end}`));

console.log(`${catalogue.cards.length} cards, ${catalogue.printings.length} printings from build ${buildId}`);
if (catalogue.untyped.length) console.log(`no type: ${catalogue.untyped.join(", ")}`);
if (catalogue.textDifferences.length)
  console.log(`printings with different text: ${catalogue.textDifferences.map((d) => d.card_id).join(", ")}`);
for (const f of catalogue.findings) console.log(findingText(f));
