export interface Config {
  discordToken: string;
  /** Only the history backfill needs it: the bot counts every server it is in. */
  guildId: string | null;
  supabaseUrl: string;
  supabaseSecretKey: string;
  /** Website base URL for links in command replies; null leaves the links out. */
  siteUrl: string | null;
  /** Riot API key for /lol link; null leaves League linking off. */
  riotApiKey: string | null;
  /** forge's intake for /feedback and the Feedback button; null answers that feedback is not set up. */
  forge: { url: string; token: string } | null;
}

const REQUIRED = {
  discordToken: "DISCORD_TOKEN",
  supabaseUrl: "SUPABASE_URL",
  supabaseSecretKey: "SUPABASE_SECRET_KEY",
} as const;

/** Read config from the environment; fail at startup, naming every missing variable. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const missing = Object.values(REQUIRED).filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`missing environment variables: ${missing.join(", ")}`);
  }
  return {
    ...Object.fromEntries(Object.entries(REQUIRED).map(([key, name]) => [key, env[name] as string])),
    // Optional so a box without it keeps counting; only the reply links go missing.
    guildId: env.DISCORD_GUILD_ID || null,
    siteUrl: env.SITE_URL || null,
    riotApiKey: env.RIOT_API_KEY || null,
    forge: env.FORGE_URL && env.FORGE_INTAKE_TOKEN ? { url: env.FORGE_URL, token: env.FORGE_INTAKE_TOKEN } : null,
  } as unknown as Config;
}
