export interface Config {
  discordToken: string;
  guildId: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
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
  return Object.fromEntries(
    Object.entries(REQUIRED).map(([key, name]) => [key, env[name] as string]),
  ) as unknown as Config;
}
