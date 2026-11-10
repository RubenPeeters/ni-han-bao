// By hand: `pnpm --filter ni-han-bao-bot cards:map` (#333). Fetches OpenRift's catalogue into
// bot/openrift-catalog.json (verbatim, with its fetch time, ETag and build id in
// bot/openrift-catalog.meta.json), then writes the printing and card maps and
// docs/openrift-mapping.md. `cards:map --offline` re-derives them from the committed snapshot.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { derive, type Source } from "./openrift-map.js";

const bot = new URL("../", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, bot), "utf8");
const URL_ = "https://openrift.app/api/v1/catalog?langs=EN,SC,FR";

if (!process.argv.includes("--offline")) {
  const contact = process.env.OPENRIFT_CONTACT?.trim();
  if (!contact) throw new Error("set OPENRIFT_CONTACT (an email or URL OpenRift can reach you at)");
  const fetchedAt = new Date().toISOString();
  const res = await fetch(URL_, { headers: { "User-Agent": `ni-han-bao (${contact})` } });
  if (!res.ok) throw new Error(`OpenRift: HTTP ${res.status}`);
  const body = await res.text();
  JSON.parse(body);
  const source: Source = {
    url: URL_, fetchedAt, etag: res.headers.get("etag"), buildId: res.headers.get("x-build-id"),
    sha256: createHash("sha256").update(body).digest("hex"),
  };
  writeFileSync(new URL("openrift-catalog.json", bot), body);
  writeFileSync(new URL("openrift-catalog.meta.json", bot), `${JSON.stringify(source, null, 2)}\n`);
}

const body = read("openrift-catalog.json");
const source = JSON.parse(read("openrift-catalog.meta.json")) as Source;
if (createHash("sha256").update(body).digest("hex") !== source.sha256) throw new Error("openrift-catalog.json does not match its meta sha256");
const out = derive(JSON.parse(read("riftbound-cards.json")), JSON.parse(body), source, JSON.parse(read("riftbound-printing-map.manual.json")));
writeFileSync(new URL("riftbound-printing-map.json", bot), out.printingMap);
writeFileSync(new URL("riftbound-card-map.json", bot), out.cardMap);
writeFileSync(new URL("../docs/openrift-mapping.md", bot), out.report);
console.log(out.report.slice(out.report.indexOf("## Counts"), out.report.indexOf("## Unmapped")).trim());
