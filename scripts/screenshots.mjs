// Build output -> full-page PNGs for visual review (forge reviewers, and you).
// Usage: `make screenshots` (builds first). Pages are discovered from app/**/page.tsx,
// so new pages are photographed without being registered anywhere. Dynamic segments are
// filled from DEMO (the demo server in supabase/seed.sql); a segment DEMO does not know
// fails the run, so no page is ever skipped silently.
// With SCREENSHOT_EMAIL and SCREENSHOT_PASSWORD (forge sets them, against the dev database)
// every page is photographed signed in as the demo server's member, plus the home page
// signed out. Without them the member pages show their logged-out state.
// `--docs` (`make docs-images`): instead, the images the docs pages show, from DOCS_SHOTS
// into public/docs/shots/, at the first screen of a 1280px window.
// `--a11y` (run by `make check`): no PNGs; runs axe-core on every page in dark and light and
// fails on serious or critical violations, so contrast and focus states cannot regress (#56).
// Browser: CHROME_PATH (set in the forge runner image), else an installed Google Chrome
// (preinstalled on GitHub's ubuntu runners, so CI needs no browser install step).
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createRequire } from "node:module";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright-core";

const OUT = ".forge/screenshots";
const PORT = Number(process.env.SCREENSHOT_PORT ?? 3123);
const WIDTHS = [375, 1280];
const A11Y = process.argv.includes("--a11y");
const DOCS = process.argv.includes("--docs");
const DOCS_OUT = "public/docs/shots";
const AXE = createRequire(import.meta.url).resolve("axe-core");
// Starter-template routes that are not part of the product.
const EXCLUDE = [/^\/auth(\/|$)/, /^\/protected(\/|$)/];
// The demo server and member from supabase/seed.sql; `month` is last month (it has a recap).
const lastMonth = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};
// `cardId` is a placeholder card from bot/riftbound-catalogue.json, which the seed loads;
// `deckId` the demo member's public deck, `version` its version with changes to list.
export const DEMO = {
  guildId: "900000000000000001",
  userId: "900000000000000101",
  month: lastMonth(),
  cardId: "placeholder-legend-ahri",
  deckId: "00000000-0000-4000-8000-0000000d0001",
  version: 2,
};

// The docs' images by name, as /docs/shots/<name>.png. Remove one only once no docs page uses it.
export const DOCS_SHOTS = [
  { name: "home", route: "/", signedOut: true },
  { name: "servers", route: "/s" },
  { name: "leaderboard", route: `/s/${DEMO.guildId}/leaderboard` },
  { name: "profile", route: `/u/${DEMO.userId}` },
  { name: "stores", route: `/s/${DEMO.guildId}/stores` },
  { name: "cards", route: "/cards" },
  { name: "collection", route: `/u/${DEMO.userId}/collection` },
  { name: "loans", route: `/u/${DEMO.userId}/loans` },
  { name: "channels", route: `/s/${DEMO.guildId}/channels` },
  { name: "emoji", route: `/s/${DEMO.guildId}/emoji` },
  { name: "games", route: `/s/${DEMO.guildId}/games` },
  { name: "timeline", route: `/s/${DEMO.guildId}/timeline` },
  { name: "recap", route: `/s/${DEMO.guildId}/recap/${DEMO.month}` },
  { name: "member", route: `/s/${DEMO.guildId}/member/${DEMO.userId}` },
  { name: "ranked", route: `/s/${DEMO.guildId}/ranked` },
  { name: "card", route: `/cards/${DEMO.cardId}` },
];

export function routesFrom(appDir = "app") {
  const routes = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/^page\.(tsx|jsx|ts|js|mdx)$/.test(name)) {
        const segs = relative(appDir, dir).split(sep).filter(Boolean)
          .filter((s) => !/^\(.*\)$/.test(s)); // route groups do not appear in URLs
        if (segs.some((s) => s.startsWith("@") || s.startsWith("_"))) continue;
        routes.push("/" + segs.map(fill).join("/"));
      }
    }
  };
  walk(appDir);
  return routes.filter((r) => !EXCLUDE.some((re) => re.test(r))).sort();
}

function fill(seg) {
  const m = /^\[(\w+)\]$/.exec(seg);
  if (!m) return seg;
  if (!(m[1] in DEMO)) throw new Error(`no demo value for [${m[1]}]: add it to DEMO in scripts/screenshots.mjs and to supabase/seed.sql`);
  return DEMO[m[1]];
}

// Slugs name the page, not the demo ids: "s-ranked", "u", "s-member", "cards-placeholder-legend-ahri".
// The card id stays: without it the card page would be named "cards", like the library.
const DEMO_IDS = new Set([DEMO.guildId, DEMO.userId, DEMO.month]);
export const slug = (route) => (route === "/" ? "home" : route.slice(1).split("/").filter((s) => !DEMO_IDS.has(s)).join("-"));

async function waitForServer(url, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server at ${url} did not come up within ${ms / 1000}s`);
}

export const blocking = (violations) =>
  violations.filter((v) => v.impact === "serious" || v.impact === "critical");

/** The screenshot user's session cookies, as @supabase/ssr writes them, or [] without a login. */
async function signIn(base) {
  const login = { email: process.env.SCREENSHOT_EMAIL, password: process.env.SCREENSHOT_PASSWORD };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!login.email || !login.password || !url || !key) return [];
  const jar = new Map();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await supabase.auth.signInWithPassword(login);
  if (error) throw new Error(`screenshot login failed: ${error.message}`);
  return [...jar].map(([name, value]) => ({ name, value, url: base }));
}

async function main() {
  mkdirSync(DOCS ? DOCS_OUT : OUT, { recursive: true });
  const base = `http://127.0.0.1:${PORT}`;
  let failures = 0;
  // Otherwise next start cannot bind and we would photograph whatever build is already there.
  if (await fetch(base, { signal: AbortSignal.timeout(2000) }).then(() => true, () => false)) {
    throw new Error(`something already answers on port ${PORT}: stop it (or set SCREENSHOT_PORT) and rerun`);
  }
  // Its own process group, so stopping it reaches next-server and not just the pnpm wrapper.
  const server = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT)], { stdio: "ignore", detached: true });
  const stop = () => {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {} // already gone, or never started
  };
  // A detached group no longer gets the terminal's Ctrl-C, so pass it on.
  for (const sig of ["SIGINT", "SIGTERM"]) process.once(sig, () => (stop(), process.exit(130)));
  try {
    await waitForServer(base);
    const browser = process.env.CHROME_PATH
      ? await chromium.launch({ executablePath: process.env.CHROME_PATH })
      : await chromium.launch({ channel: "chrome" });
    try {
      const cookies = await signIn(base);
      // The not-found page has no page.tsx to discover, so visit it via an unknown path.
      // Docs images need the demo member: signed out, the server pages are empty.
      if (DOCS && !cookies.length) throw new Error("docs images need SCREENSHOT_EMAIL, SCREENSHOT_PASSWORD and the Supabase env vars");
      const shots = DOCS
        ? DOCS_SHOTS.map(({ name, route, signedOut }) => ({ route, name, cookies: signedOut ? [] : cookies }))
        : [...routesFrom(), "/not-found"].map((route) => ({ route, name: slug(route), cookies }));
      if (cookies.length && !DOCS) {
        shots.push({ route: "/", name: "home-signed-out", cookies: [] });
        // A public deck's teaser (#175).
        shots.push({ route: `/decks/${DEMO.deckId}`, name: "deck-signed-out", cookies: [] });
      }
      const dupes = shots.map((s) => s.name).filter((n, i, all) => all.indexOf(n) !== i);
      if (dupes.length) throw new Error(`two pages would share a screenshot name: ${dupes.join(", ")}`);
      for (const { route, name, cookies } of shots) {
        for (const width of DOCS ? [1280] : WIDTHS) {
          for (const theme of DOCS ? ["dark"] : ["dark", "light"]) {
            const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
            await ctx.addCookies(cookies);
            // next-themes defaults to dark whatever the OS says; its stored choice is what switches.
            await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
            const page = await ctx.newPage();
            await page.goto(base + route, { waitUntil: "networkidle", timeout: 30_000 });
            if (A11Y) {
              await page.addScriptTag({ path: AXE });
              const found = blocking(await page.evaluate(() => window.axe.run().then((r) => r.violations)));
              failures += found.length;
              console.log(`${found.length ? "FAIL" : "ok  "} ${route} ${width}px ${theme}`);
              for (const v of found) {
                console.log(`  ${v.impact} ${v.id}: ${v.help} (${v.helpUrl})`);
                for (const n of v.nodes) console.log(`    ${n.target.join(" ")}: ${n.failureSummary.replaceAll("\n", " ")}`);
              }
            } else if (DOCS) {
              const file = `${DOCS_OUT}/${name}.png`;
              await page.screenshot({ path: file });
              console.log(file);
            } else {
              const file = `${OUT}/${name}-${width}${theme === "dark" ? "" : "-light"}.png`;
              await page.screenshot({ path: file, fullPage: true });
              console.log(file);
            }
            await ctx.close();
          }
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    stop();
  }
  if (failures) throw new Error(`${failures} serious or critical accessibility violation(s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
