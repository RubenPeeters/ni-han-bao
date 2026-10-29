// On demand: `pnpm --filter ni-han-bao-bot cards:check-images`. The domain symbol on Riot's image
// of every printing in the feed against the card's domain, after corrections (#324). Only reports:
// full-art cards can be misread, so a finding is checked by eye before it becomes a correction.
import { findingText, symbolFindings } from "./riftbound-checks.js";
import { CORRECTIONS, feedItems, fetchFeed, transformFeed } from "./riftbound-feed.js";

const { buildId, feed } = await fetchFeed();
const { cards, printings } = transformFeed(feedItems(feed), CORRECTIONS);
const findings = await symbolFindings(cards, printings);
for (const f of findings) console.log(findingText(f));
console.log(`${findings.length} domain symbol findings in ${printings.length} printings from build ${buildId}`);
