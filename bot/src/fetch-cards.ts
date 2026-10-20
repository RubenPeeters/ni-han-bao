// By hand, when Riot publishes cards: `pnpm --filter ni-han-bao-bot cards`. Writes the real
// card data (bot/riftbound-cards.json) and where it came from (bot/riftbound-cards.manifest.json).
// Commit both; the same feed gives a byte-identical card file.
import { writeFileSync } from "node:fs";
import { cardsJson, feedItems, fetchFeed, manifest, transformFeed } from "./riftbound-feed.js";

const bot = new URL("../", import.meta.url);

const fetchedAt = new Date();
const { url, buildId, feed } = await fetchFeed();
const catalogue = transformFeed(feedItems(feed));
const json = cardsJson(catalogue);
writeFileSync(new URL("riftbound-cards.json", bot), json);
writeFileSync(new URL("riftbound-cards.manifest.json", bot), manifest(catalogue, json, { url, buildId, fetchedAt }));

console.log(`${catalogue.cards.length} cards, ${catalogue.printings.length} printings from build ${buildId}`);
if (catalogue.untyped.length) console.log(`no type: ${catalogue.untyped.join(", ")}`);
if (catalogue.textDifferences.length)
  console.log(`printings with different text: ${catalogue.textDifferences.map((d) => d.card_id).join(", ")}`);
