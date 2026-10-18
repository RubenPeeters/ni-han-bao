// Proves anonymous visitors reach the public pages without a redirect (#26), and that the
// old single-server URLs send them to the server picker (#44).
// Runs against the production build, so `next build` must have run first.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

// CI builds without Supabase env vars, and the starter's proxy skipped its redirect in that
// case, so a 200 below alone would not catch it coming back: also require that no proxy exists.
const { functions } = JSON.parse(
  readFileSync(".next/server/functions-config-manifest.json", "utf8"),
);
if (functions["/_middleware"]) {
  console.error("FAIL a proxy/middleware is built; it could redirect anonymous visitors");
  process.exit(1);
}

const PAGES = ["/", "/s", "/about"];
const LEGACY = ["/leaderboard", "/channels", "/emoji", "/timeline"];
const port = 3999;
const base = `http://localhost:${port}`;

const server = spawn("pnpm", ["exec", "next", "start", "-p", String(port)], {
  stdio: "ignore",
  detached: true,
});
const stop = () => process.kill(-server.pid);

let failed = false;
try {
  for (let i = 0; ; i++) {
    try {
      await fetch(base, { redirect: "manual" });
      break;
    } catch {
      if (i >= 60) throw new Error("next start did not come up within 30s");
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  for (const path of PAGES) {
    const res = await fetch(base + path, { redirect: "manual" });
    const ok = res.status === 200;
    if (!ok) failed = true;
    console.log(`${ok ? "ok  " : "FAIL"} ${path} -> ${res.status} ${res.headers.get("location") ?? ""}`);
  }
  for (const path of LEGACY) {
    const res = await fetch(base + path, { redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    const ok = res.status === 307 && new URL(location, base).pathname === "/s";
    if (!ok) failed = true;
    console.log(`${ok ? "ok  " : "FAIL"} ${path} -> ${res.status} ${location}`);
  }
  // Link previews (#55): every page points at the generated image, and it renders logged out.
  const html = await (await fetch(`${base}/s`)).text();
  const image = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  const png = image && (await fetch(base + new URL(image).pathname));
  const previewOk = png?.status === 200 && png.headers.get("content-type") === "image/png";
  if (!previewOk) failed = true;
  console.log(`${previewOk ? "ok  " : "FAIL"} og:image ${image} -> ${png?.status}`);
  // Unknown paths get the styled not-found page (#58), not Next's default one.
  const res = await fetch(`${base}/no-such-page`, { redirect: "manual" });
  const ok = res.status === 404 && (await res.text()).includes("Page not found");
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"} /no-such-page -> ${res.status} (styled 404)`);
} finally {
  stop();
}
process.exit(failed ? 1 : 0);
