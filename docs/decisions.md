## 2026-11-06: Riftbound card data from OpenRift instead of Riot's card-gallery feed

**Decision.** The Riftbound catalogue is taken from OpenRift's public API (https://openrift.app/api/v1/catalog) instead of scraping Riot's card-gallery feed (`playriftbound.com/_next/data/{buildId}/…`). ni-han-bao adopts OpenRift's printing model: one printing per art × finish × language, identified by OpenRift's ids. Finish and language follow from the printing instead of being columns the owner sets independently.

**Why.** Ruben judged OpenRift the better source (2026-11-06). Further reasons were not stated.

**How user data is protected.** Old and new ids are linked by an exact, committed mapping (`bot/riftbound-printing-map.json`, generated, plus `bot/riftbound-printing-map.manual.json`, reviewed by hand). The migration aborts if any stored row has no mapping, and the map is kept as an audit trail. Ruben's requirement: "make a robust mapping between existing and new listings, and make sure we know what is new and why."

**New listings.** All OpenRift printings without a Riot counterpart (promos, signed, event and other variants) enter the catalogue, each with a reason derived from OpenRift's own fields (Ruben, 2026-11-06).

**Languages.** EN, SC and FR (ni-han-bao's `en`, `zh-Hans`, `fr`). KR and TC are left out for now. (Default set when the issues were written; not yet confirmed by Ruben.)

**Facet icons.** OpenRift has none; the existing Riot icon rows are kept as static data. (Default set when the issues were written; not yet confirmed by Ruben.)

**Ids.** Card and printing ids become OpenRift's UUIDs, with OpenRift's slug kept alongside. (Default set when the issues were written; not yet confirmed by Ruben.)
