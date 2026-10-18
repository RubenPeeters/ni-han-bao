export interface Config {
  discordToken: string;
  guildId: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
  /** Website base URL for links in command replies; null leaves the links out. */
  siteUrl: string | null;
  /** Channel for the weekly report card; null turns the report off. */
  reportChannelId: string | null;
}

const REQUIRED = {
  discordToken: "DISCORD_TOKEN",
  guildId: "DISCORD_GUILD_ID",
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
    siteUrl: env.SITE_URL || null,
    reportChannelId: env.REPORT_CHANNEL_ID || null,
  } as unknown as Config;
}
