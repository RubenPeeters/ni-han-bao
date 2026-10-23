import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

const TIMEOUT_MS = 5_000;
const MAX_HTML = 1024 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT = "ni-han-bao-bot (Discord bot; store link previews)";

// Everything that is not the public internet: the box's own network, the cloud metadata
// address, documentation and reserved ranges.
const NON_PUBLIC = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) NON_PUBLIC.addSubnet(net, prefix, "ipv4");
// IPv6: only global unicast (2000::/3) and IPv4-mapped, which BlockList checks against the
// IPv4 ranges above; everything else (site-local, NAT64, ULA, ...) is refused.
const PUBLIC_V6 = new BlockList();
PUBLIC_V6.addSubnet("2000::", 3, "ipv6");
PUBLIC_V6.addSubnet("::ffff:0:0", 96, "ipv6");
// Special-purpose blocks inside 2000::/3: IETF assignments (incl. Teredo), documentation,
// and 6to4, which embeds an arbitrary IPv4 address.
for (const [net, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) {
  NON_PUBLIC.addSubnet(net, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !NON_PUBLIC.check(address, "ipv4");
  return family === 6 && PUBLIC_V6.check(address, "ipv6") && !NON_PUBLIC.check(address, "ipv6");
}

/** The page's preview image (og:image, else twitter:image) as an absolute https URL, or null. */
export function previewImage(html: string, pageUrl: string): string | null {
  const found = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4]);
    }
    const key = (attrs.get("property") ?? attrs.get("name"))?.toLowerCase();
    const content = attrs.get("content");
    if (key && content && !found.has(key)) found.set(key, decodeEntities(content.trim()));
  }
  const image = found.get("og:image") ?? found.get("twitter:image");
  if (!image) return null;
  try {
    const url = new URL(image, pageUrl);
    // The site puts it in an <img>: https only, and a sane length for the column.
    return url.protocol === "https:" && url.href.length <= 2000 ? url.href : null;
  } catch {
    return null;
  }
}

function decodeEntities(text: string): string {
  return text.replace(/&(amp|quot|apos|lt|gt|#39|#x27);/gi, (_, e: string) =>
    ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", "#39": "'", "#x27": "'" })[e.toLowerCase()]!,
  );
}

// Resolves and checks in one step, and the socket connects to the address checked, so a
// second DNS answer cannot swap in a private one.
const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, "", 0);
    if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address))) {
      return callback(new Error(`${hostname} resolves to a non-public address`), "", 0);
    }
    if (options.all) (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
};

/** GETs one https page, refusing non-public hosts (also after each redirect); the final URL and at most 1 MB of its HTML. */
export async function fetchPage(url: string, signal = AbortSignal.timeout(TIMEOUT_MS)): Promise<{ url: string; html: string }> {
  let current = new URL(url);
  for (let redirects = 0; ; redirects++) {
    if (current.protocol !== "https:") throw new Error(`not https: ${current.href}`);
    // Node skips the lookup for an IP literal, so check that here.
    const host = current.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && !isPublicAddress(host)) throw new Error(`${host} is not a public address`);
    const res = await get(current, signal);
    if (res.location !== null) {
      if (redirects >= MAX_REDIRECTS) throw new Error("too many redirects");
      current = new URL(res.location, current);
      continue;
    }
    return { url: current.href, html: res.html };
  }
}

function get(url: URL, signal: AbortSignal): Promise<{ location: string | null; html: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" }, lookup: publicLookup, signal }, (res) => {
      const status = res.statusCode ?? 0;
      // Bodies we do not read are cut off, not drained: MAX_HTML would not limit them.
      if (status >= 300 && status < 400 && res.headers.location) {
        res.destroy();
        return resolve({ location: res.headers.location, html: "" });
      }
      if (status !== 200) {
        res.destroy();
        return reject(new Error(`HTTP ${status}`));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      const done = () => resolve({ location: null, html: Buffer.concat(chunks).toString("utf8") });
      res.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        size += chunk.length;
        // The tags are in <head>: the first MB is plenty, and the rest is never read.
        if (size >= MAX_HTML) {
          chunks.splice(0, chunks.length, Buffer.concat(chunks).subarray(0, MAX_HTML));
          res.destroy();
          done();
        }
      });
      res.on("end", done);
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

/** The preview image of a store's link, or null when it has none. Throws when the page cannot be read. */
export async function storeImage(url: string): Promise<string | null> {
  const page = await fetchPage(url);
  return previewImage(page.html, page.url);
}
