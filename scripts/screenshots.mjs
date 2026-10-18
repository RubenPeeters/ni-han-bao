// Build output -> full-page PNGs for visual review (forge reviewers, and you).
// Usage: `make screenshots` (builds first). Pages are discovered from app/**/page.tsx,
// so new pages are photographed without being registered anywhere.
// Browser: CHROME_PATH (set in the forge runner image), else Playwright's default.
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { chromium } from "playwright-core";

const OUT = ".forge/screenshots";
const PORT = Number(process.env.SCREENSHOT_PORT ?? 3123);
const WIDTHS = [375, 1280];
// Starter-template routes that are not part of the product.
const EXCLUDE = [/^\/auth(\/|$)/, /^\/protected(\/|$)/];

export function routesFrom(appDir = "app") {
  const routes = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/^page\.(tsx|jsx|ts|js)$/.test(name)) {
        const segs = relative(appDir, dir).split(sep).filter(Boolean)
          .filter((s) => !/^\(.*\)$/.test(s)); // route groups do not appear in URLs
        if (segs.some((s) => s.startsWith("[") || s.startsWith("@") || s.startsWith("_"))) continue;
        routes.push("/" + segs.join("/"));
      }
    }
  };
  walk(appDir);
  return routes.filter((r) => !EXCLUDE.some((re) => re.test(r))).sort();
}

export const slug = (route) => (route === "/" ? "home" : route.slice(1).replaceAll("/", "-"));

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

async function main() {
  mkdirSync(OUT, { recursive: true });
  const base = `http://127.0.0.1:${PORT}`;
  const server = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT)], { stdio: "ignore" });
  try {
    await waitForServer(base);
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
    try {
      for (const route of routesFrom()) {
        for (const width of WIDTHS) {
          const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: "dark" });
          const page = await ctx.newPage();
          await page.goto(base + route, { waitUntil: "networkidle", timeout: 30_000 });
          const file = `${OUT}/${slug(route)}-${width}.png`;
          await page.screenshot({ path: file, fullPage: true });
          console.log(file);
          await ctx.close();
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill("SIGTERM");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
