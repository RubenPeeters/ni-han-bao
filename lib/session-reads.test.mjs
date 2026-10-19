import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

// Per-server stats are read with the visitor's session (authenticated role), so the RLS that
// limits servers to their members applies (#44). A "use cache" result is shared by every
// visitor (#53) and cannot read cookies, so no component may cache, nor read as plain anon.
const files = readdirSync("components", { recursive: true })
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => `components/${f}`);

for (const f of files) {
  test(`${f} reads with the session and does not cache`, () => {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /"use cache|lib\/supabase\/public/);
  });
}

test("per-server pages check membership", () => {
  for (const page of ["leaderboard", "channels", "emoji", "timeline", "member/[userId]", "recap/[month]", "games"]) {
    const src = readFileSync(`app/s/[guildId]/${page}/page.tsx`, "utf8");
    assert.match(src, /await memberGuild\(params\)/, page);
  }
});

// Unfurlers fetch link previews logged out, so the image may show public totals only (#55).
test("the Open Graph image reads public_totals() and nothing else", () => {
  const src = readFileSync("app/opengraph-image.tsx", "utf8");
  assert.deepEqual(src.match(/\.(rpc|from)\("\w+"/g), ['.rpc("public_totals"']);
  assert.doesNotMatch(src, /lib\/supabase\/server|cookies\(/);
});

// The recap card is fetched by the bot without a session (#75): monthly_recap() is what checks
// membership or the month's key, so the route must read through it and nothing else.
test("the recap card reads monthly_recap() and nothing else", () => {
  const src = readFileSync("app/s/[guildId]/recap/[month]/og/route.tsx", "utf8");
  assert.deepEqual(src.match(/\.(rpc|from)\("\w+"/g), ['.rpc("monthly_recap"']);
});

// Profiles (#100): who may see one is decided by can_see_profile() in the database, so the
// page reads through the functions that call it and never a per-server table directly.
test("the profile page reads through the profile functions only", () => {
  const src = readFileSync("components/profile-stats.tsx", "utf8");
  assert.deepEqual(src.match(/\.(rpc|from)\("\w+"/g), ['.rpc("profile"', '.rpc("profile_servers"', '.rpc("profile_badges"', '.rpc("profile_games"']);
});
