// Build output -> full-page PNGs for visual review (forge reviewers, and you).
// Usage: `make screenshots` (builds first). Pages are discovered from app/**/page.tsx,
// so new pages are photographed without being registered anywhere.
// `--a11y` (run by `make check`): no PNGs; runs axe-core on every page in dark and light and
// fails on serious or critical violations, so contrast and focus states cannot regress (#56).
// Browser: CHROME_PATH (set in the forge runner image), else an installed Google Chrome
// (preinstalled on GitHub's ubuntu runners, so CI needs no browser install step).
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const OUT = ".forge/screenshots";
const PORT = Number(process.env.SCREENSHOT_PORT ?? 3123);
const WIDTHS = [375, 1280];
const A11Y = process.argv.includes("--a11y");
const AXE = createRequire(import.meta.url).resolve("axe-core");
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

export const blocking = (violations) =>
  violations.filter((v) => v.impact === "serious" || v.impact === "critical");

async function main() {
  mkdirSync(OUT, { recursive: true });
  const base = `http://127.0.0.1:${PORT}`;
  let failures = 0;
  const server = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT)], { stdio: "ignore" });
  try {
    await waitForServer(base);
    const browser = process.env.CHROME_PATH
      ? await chromium.launch({ executablePath: process.env.CHROME_PATH })
      : await chromium.launch({ channel: "chrome" });
    try {
      // The not-found page has no page.tsx to discover, so visit it via an unknown path.
      for (const route of [...routesFrom(), "/not-found"]) {
        for (const width of WIDTHS) {
          for (const theme of A11Y ? ["dark", "light"] : ["dark"]) {
            const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
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
            } else {
              const file = `${OUT}/${slug(route)}-${width}.png`;
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
    server.kill("SIGTERM");
  }
  if (failures) throw new Error(`${failures} serious or critical accessibility violation(s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
