// By hand: `pnpm --filter ni-han-bao-bot cards:map` (#333). Maps the committed Riot catalogue to
// the committed OpenRift snapshot and writes bot/riftbound-printing-map.json,
// bot/riftbound-card-map.json and docs/openrift-mapping.md: the same two inputs give
// byte-identical files. `cards:map --fetch` first refreshes the snapshot (needs OPENRIFT_CONTACT).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mapFiles, type Source } from "./openrift-map.js";

const bot = new URL("../", import.meta.url);
const SNAPSHOT = new URL("openrift-catalog.json", bot);
const SNAPSHOT_MANIFEST = new URL("openrift-catalog.manifest.json", bot);
const URL_ = "https://openrift.app/api/v1/catalog?langs=EN,SC,FR";

if (process.argv.includes("--fetch")) {
  const contact = process.env.OPENRIFT_CONTACT;
  if (!contact) throw new Error("set OPENRIFT_CONTACT to a contact for OpenRift (an e-mail address or URL)");
  const res = await fetch(URL_, { headers: { "User-Agent": `ni-han-bao (+https://github.com/RubenPeeters/ni-han-bao; ${contact})` } });
  if (!res.ok) throw new Error(`${URL_}: HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  const source: Source = {
    url: URL_,
    fetched_at: new Date().toISOString(),
    etag: res.headers.get("etag"),
    build_id: res.headers.get("x-build-id"),
    sha256: createHash("sha256").update(body).digest("hex"),
  };
  writeFileSync(SNAPSHOT, body);
  writeFileSync(SNAPSHOT_MANIFEST, `${JSON.stringify(source, null, 2)}\n`);
}

const outputs = mapFiles(readFileSync(new URL("riftbound-cards.json", bot), "utf8"), readFileSync(SNAPSHOT), readFileSync(SNAPSHOT_MANIFEST, "utf8"), readFileSync(new URL("riftbound-cards.manifest.json", bot), "utf8"));
mkdirSync(new URL("../docs/", bot), { recursive: true });
for (const [path, text] of Object.entries(outputs)) writeFileSync(new URL(path, bot), text);
console.log(outputs["../docs/openrift-mapping.md"].split("\n## Unmapped")[0]);

