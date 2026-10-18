import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const full = {
  DISCORD_TOKEN: "t",
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SECRET_KEY: "s",
};

describe("loadConfig", () => {
  it("maps env vars", () => {
    expect(loadConfig(full)).toEqual({
      discordToken: "t",
      guildId: null,
      supabaseUrl: "https://x.supabase.co",
      supabaseSecretKey: "s",
      siteUrl: null,
      reportChannelId: null,
    });
  });

  it("reads the optional site url", () => {
    expect(loadConfig({ ...full, SITE_URL: "https://x.example" }).siteUrl).toBe("https://x.example");
  });

  it("reads the optional guild id", () => {
    expect(loadConfig({ ...full, DISCORD_GUILD_ID: "g" }).guildId).toBe("g");
  });

  it("reads the optional report channel", () => {
    expect(loadConfig({ ...full, REPORT_CHANNEL_ID: "123" }).reportChannelId).toBe("123");
  });

  it("names every missing variable", () => {
    expect(() => loadConfig({ DISCORD_TOKEN: "t" })).toThrow(
      "missing environment variables: SUPABASE_URL, SUPABASE_SECRET_KEY",
    );
  });
});
