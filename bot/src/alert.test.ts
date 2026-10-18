import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Runs bot/deploy/alert.sh against a fake curl, so no network, Supabase or Discord.
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "alert-"));
  copyFileSync(new URL("../deploy/alert.sh", import.meta.url), join(dir, "alert.sh"));
  writeFileSync(
    join(dir, ".env"),
    "SUPABASE_URL=https://db.test\nSUPABASE_PUBLISHABLE_KEY=pk\nSITE_URL=https://site.test\nALERT_WEBHOOK=https://hook.test\n",
  );
  const curl = join(dir, "curl");
  writeFileSync(
    curl,
    `#!/bin/sh
case "$*" in
  *hook.test*) [ -n "$FAIL_POST" ] && exit 22; for a; do [ "$prev" = -d ] && echo "$a" >> "${dir}/posts"; prev=$a; done ;;
  *db.test/rest/v1/rpc/public_totals*) [ -n "$HEARTBEAT" ] || exit 7; printf '%s' "$HEARTBEAT" ;;
  *site.test*) printf '%s' "$CODE" ;;
esac
`,
  );
  chmodSync(curl, 0o755);
  writeFileSync(join(dir, "posts"), "");
  const run = (env: { HEARTBEAT: string; CODE: string; FAIL_POST?: string }) => {
    try {
      execFileSync("bash", [join(dir, "alert.sh")], {
        env: { ...process.env, ...env, PATH: `${dir}:${process.env.PATH}`, STATE_DIRECTORY: join(dir, "state") },
      });
      return 0;
    } catch (err) {
      return (err as { status: number }).status;
    }
  };
  const posts = () => readFileSync(join(dir, "posts"), "utf8").trim().split("\n").filter(Boolean);
  return { run, posts };
}

const UP = { HEARTBEAT: '[{"bot_last_seen":"2026-10-18T12:00:00+00:00"}]', CODE: "200" };

describe("alert.sh", () => {
  it("stays quiet while everything is up", () => {
    const { run, posts } = setup();
    expect(run(UP)).toBe(0);
    expect(posts()).toEqual([]);
  });

  it("posts once when the heartbeat goes stale and once when it recovers", () => {
    const { run, posts } = setup();
    run({ ...UP, HEARTBEAT: "[]" });
    run({ ...UP, HEARTBEAT: "[]" });
    expect(posts()).toHaveLength(1);
    expect(posts()[0]).toContain("Bot heartbeat is older than 10 minutes");
    run(UP);
    run(UP);
    expect(posts()).toHaveLength(2);
    expect(posts()[1]).toContain("Bot heartbeat is back");
  });

  it("treats an unreadable heartbeat as stale", () => {
    const { run, posts } = setup();
    run({ ...UP, HEARTBEAT: "" });
    expect(posts()[0]).toContain("Bot heartbeat");
  });

  it("alerts on a non-200 site response with the status code", () => {
    const { run, posts } = setup();
    run({ ...UP, CODE: "503" });
    run({ ...UP, CODE: "503" });
    expect(posts()).toEqual(['{"content":":red_circle: Site https://site.test answered 503 instead of 200."}']);
    run(UP);
    expect(posts()[1]).toContain("answers 200 again");
  });

  it("retries a post Discord did not take", () => {
    const { run, posts } = setup();
    expect(run({ ...UP, CODE: "500", FAIL_POST: "1" })).toBe(1);
    run({ ...UP, CODE: "500" });
    expect(posts()).toHaveLength(1);
  });
});
