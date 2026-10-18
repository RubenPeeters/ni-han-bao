import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { forgetMe } from "./forget.js";

const migrations = new URL("../../supabase/migrations/", import.meta.url);
const sql = readdirSync(migrations)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(new URL(f, migrations), "utf8"))
  .join("\n");

/** Tables that get a user_id column, from create table or alter table ... add column. */
function perUserTables(source: string): Set<string> {
  const tables = new Set<string>();
  for (const [, table, body] of source.matchAll(/create table (?:if not exists )?public\.(\w+) \(([\s\S]*?)\n\);/g)) {
    if (/^\s*user_id\s/m.test(body)) tables.add(table);
  }
  for (const [, table] of source.matchAll(/alter table public\.(\w+)\s+add column (?:if not exists )?user_id\s/g)) {
    tables.add(table);
  }
  return tables;
}

function guardedTables(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/create trigger skip_forgotten before insert on public\.(\w+)/g)].map((m) => m[1]),
  );
}

describe("forgotten users", () => {
  it("finds the per-user tables known when /forget-me was added", () => {
    // Guards the parser: if it found nothing, the next test would pass vacuously.
    expect([...perUserTables(sql)]).toEqual(
      expect.arrayContaining([
        "members",
        "message_counts",
        "reactions_received",
        "voice_seconds",
        "guild_members",
        "member_channel_counts",
        "member_emoji_counts",
      ]),
    );
  });

  // forget_user() deletes from every user_id table it finds in the catalog; the trigger is
  // what keeps a forgotten user from being written again, and needs adding per table.
  it("keeps forgotten users out of every per-user table", () => {
    const guarded = guardedTables(sql);
    expect([...perUserTables(sql)].filter((t) => !guarded.has(t))).toEqual([]);
  });

  // Without the shared lock a write overlapping an uncommitted forget_user() passes the
  // check and lands after the delete (#95 review).
  it("serializes writes with forget_user() on a per-user lock", () => {
    expect(sql).toMatch(/function public\.skip_forgotten\(\)[\s\S]*?perform public\.lock_user\(new\.user_id, false\);\s+if exists/);
    expect(sql).toMatch(/function public\.forget_user\(member text\)[\s\S]*?begin\s+perform public\.lock_user\(member, true\);/);
  });

  it("flags a new per-user table without the trigger", () => {
    const added = `${sql}\ncreate table if not exists public.member_streaks (\n    guild_id text not null,\n    user_id text not null\n);\n`;
    const guarded = guardedTables(added);
    expect([...perUserTables(added)].filter((t) => !guarded.has(t))).toEqual(["member_streaks"]);
  });
});

describe("forgetMe", () => {
  it("deletes nothing without confirmation", async () => {
    const forget = vi.fn(async () => {});
    expect(await forgetMe({ forget }, "a", false)).toMatch(/nothing was deleted/);
    expect(forget).not.toHaveBeenCalled();
  });

  it("forgets the caller once confirmed", async () => {
    const forget = vi.fn(async () => {});
    expect(await forgetMe({ forget }, "a", true)).toMatch(/deleted/);
    expect(forget).toHaveBeenCalledWith("a");
  });

  it("tells the caller when the delete fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reply = await forgetMe({ forget: async () => Promise.reject(new Error("down")) }, "a", true);
    expect(reply).toMatch(/nothing was deleted/);
  });
});
