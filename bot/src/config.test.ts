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
      riotApiKey: null,
      forge: null,
    });
  });

  it("reads the optional site url", () => {
    expect(loadConfig({ ...full, SITE_URL: "https://x.example" }).siteUrl).toBe("https://x.example");
  });

  it("reads the optional riot api key", () => {
    expect(loadConfig({ ...full, RIOT_API_KEY: "r" }).riotApiKey).toBe("r");
  });

  it("reads forge's intake only with both its url and token", () => {
    expect(loadConfig({ ...full, FORGE_URL: "https://forge.example", FORGE_INTAKE_TOKEN: "k" }).forge).toEqual({ url: "https://forge.example", token: "k" });
    expect(loadConfig({ ...full, FORGE_URL: "https://forge.example" }).forge).toBeNull();
  });

  it("reads the optional guild id", () => {
    expect(loadConfig({ ...full, DISCORD_GUILD_ID: "g" }).guildId).toBe("g");
  });

  it("names every missing variable", () => {
    expect(() => loadConfig({ DISCORD_TOKEN: "t" })).toThrow(
      "missing environment variables: SUPABASE_URL, SUPABASE_SECRET_KEY",
    );
  });
});
