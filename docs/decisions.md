## 2026-11-06: Riftbound card data from OpenRift instead of Riot's card-gallery feed

**Decision.** The Riftbound catalogue is taken from OpenRift's public API (https://openrift.app/api/v1/catalog) instead of scraping Riot's card-gallery feed (`playriftbound.com/_next/data/{buildId}/…`). ni-han-bao adopts OpenRift's printing model: one printing per art × finish × language, identified by OpenRift's ids. Finish and language follow from the printing instead of being columns the owner sets independently.

**Why.** Ruben judged OpenRift the better source (2026-11-06). Further reasons were not stated.

**How user data is protected.** Old and new ids are linked by an exact, committed mapping (`bot/riftbound-printing-map.json`, generated, plus `bot/riftbound-printing-map.manual.json`, reviewed by hand). The migration aborts if any stored row has no mapping, and the map is kept as an audit trail. Ruben's requirement: "make a robust mapping between existing and new listings, and make sure we know what is new and why."

**New listings.** All OpenRift printings without a Riot counterpart (promos, signed, event and other variants) enter the catalogue, each with a reason derived from OpenRift's own fields (Ruben, 2026-11-06).

**Languages.** EN, SC and FR (ni-han-bao's `en`, `zh-Hans`, `fr`). KR and TC are left out for now. (Default set when the issues were written; not yet confirmed by Ruben.)

**Facet icons.** OpenRift has none; the existing Riot icon rows are kept as static data. (Default set when the issues were written; not yet confirmed by Ruben.)

**Ids.** Card and printing ids become OpenRift's UUIDs, with OpenRift's slug kept alongside. (Default set when the issues were written; not yet confirmed by Ruben.)

## 2026-11-10: Review and direction

Ruben had the product reviewed on 2026-11-10 (strategy, technical, UX, legal) and chose a direction.

**Riftbound first.** The Riftbound tools for a playgroup (collection, lending, trades, wishlists between people who meet) are the product to grow. The landing page leads with them; server statistics come second. **Why:** Ruben: they are the most used part, and the group features are what Piltover Archive, the existing collection tracker, does not have. Today the bot is in three servers, all friends.

**Server statistics.** They keep working, and get no new features for now. **Why:** focus; statistics bots are common and free.

**Game time.** Game time from Discord status becomes opt-in per member. **Why:** it is the most invasive data the bot keeps and members were never asked. Ruben chose opt-in over removing the feature.

**Login return.** After logging in, a visitor returns to the page they came from, not always the server picker. **Why:** a Riftbound player who logs in on the Collection page should land there.

**Contact.** Questions and data requests go to an email address read from a site setting, next to the GitHub link. **Why:** a data request should not have to be a public issue. Ruben chose a setting he fills in, so no address is committed to this public repository.

**Data retention.** A server's data is deleted 30 days after the bot is removed from it. **Why:** data should not be kept without a purpose; 30 days allows for a mistaken kick. (30 days is a default set when the issues were written; not yet confirmed by Ruben.)

**Pinned dependencies.** `next`, `@supabase/ssr` and `@supabase/supabase-js` are pinned to versions instead of `latest`. **Why:** a build must not change without a commit.

**Not decided, waiting on Ruben.** Paid features (Riot's rules, the Vercel plan and his legal status as operator come first), the privacy text's facts (where the database is hosted), and the format of a Piltover Archive export.
