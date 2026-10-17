import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const full = {
  DISCORD_TOKEN: "t",
  DISCORD_GUILD_ID: "g",
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SECRET_KEY: "s",
};

describe("loadConfig", () => {
  it("maps env vars", () => {
    expect(loadConfig(full)).toEqual({
      discordToken: "t",
      guildId: "g",
      supabaseUrl: "https://x.supabase.co",
      supabaseSecretKey: "s",
      siteUrl: null,
    });
  });

  it("reads the optional site url", () => {
    expect(loadConfig({ ...full, SITE_URL: "https://x.example" }).siteUrl).toBe("https://x.example");
  });

  it("names every missing variable", () => {
    expect(() => loadConfig({ DISCORD_TOKEN: "t" })).toThrow(
      "missing environment variables: DISCORD_GUILD_ID, SUPABASE_URL, SUPABASE_SECRET_KEY",
    );
  });
});
