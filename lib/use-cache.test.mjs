import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

// A "use cache" result is shared by every visitor (#53): it must never be read with a
// user's session, so a file that caches may not touch cookies or the session client.
const files = readdirSync("components", { recursive: true })
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => `components/${f}`);
const cached = files.filter((f) => readFileSync(f, "utf8").includes('"use cache"'));

test("stat components are cached", () => {
  assert.ok(cached.length >= 5, `only ${cached.join(", ")}`);
});

for (const f of cached) {
  test(`${f} caches without the session`, () => {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /@\/lib\/supabase\/server|next\/headers|loadStatus\(\)\s*\{/);
  });
}

test("bot status stays live", () => {
  assert.doesNotMatch(readFileSync("components/bot-status.tsx", "utf8"), /"use cache"/);
});
