import { ApplicationCommandOptionType, ChannelType, PermissionFlagsBits } from "discord.js";
import { timeZoneName } from "./zone.js";

/** Per-server settings, one guild_settings row. */
export interface GuildSettings {
  report_channel_id: string | null;
  timezone: string;
  public_totals_opt_out: boolean;
}

/** A server that never used /setup; matches the table's defaults. */
export const DEFAULT_SETTINGS: GuildSettings = { report_channel_id: null, timezone: "UTC", public_totals_opt_out: false };

export const SETUP_COMMAND = {
  name: "setup",
  description: "Configure ni han bao for this server",
  // Discord hides the command from members without Manage Server (unless the server's
  // admins change that in the integration settings).
  default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
  options: [
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "report-channel",
      description: "Where the weekly report card goes; leave the channel out to turn it off",
      options: [
        {
          type: ApplicationCommandOptionType.Channel,
          name: "channel",
          description: "A text channel the bot can post in",
          channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
        },
      ],
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "timezone",
      description: "Time zone for today, this week and the weekly report",
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: "timezone",
          description: "An IANA time zone, like Europe/Brussels",
          required: true,
        },
      ],
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "public-totals",
      description: "Whether this server counts toward the totals on the public home page",
      options: [
        {
          type: ApplicationCommandOptionType.Boolean,
          name: "include",
          description: "False leaves this server out of them",
          required: true,
        },
      ],
    },
    { type: ApplicationCommandOptionType.Subcommand, name: "show", description: "Show this server's settings" },
  ],
} as const;

export interface SetupInput {
  subcommand: string;
  channelId: string | null;
  /** Whether the bot can send messages in `channelId`. */
  canSend: boolean;
  timezone: string | null;
  include: boolean | null;
}

/** The change a /setup subcommand asks for, a reply explaining why there is none, or null for show. */
export function setupChange(input: SetupInput): Partial<GuildSettings> | string | null {
  if (input.subcommand === "report-channel") {
    if (input.channelId && !input.canSend) {
      return `I cannot post in <#${input.channelId}>. Give me View Channel and Send Messages there, then try again.`;
    }
    return { report_channel_id: input.channelId };
  }
  if (input.subcommand === "timezone") {
    const timezone = timeZoneName(input.timezone ?? "");
    if (!timezone) return `"${input.timezone}" is not a time zone. Use an IANA name, like Europe/Brussels.`;
    return { timezone };
  }
  if (input.subcommand === "public-totals") return { public_totals_opt_out: input.include === false };
  return null;
}

export function settingsText(s: GuildSettings): string {
  const report = s.report_channel_id ? `<#${s.report_channel_id}>` : "off (turn it on with /setup report-channel)";
  const totals = s.public_totals_opt_out ? "left out" : "included";
  return `Weekly report card: ${report}\nTime zone: ${s.timezone}\nPublic totals: ${totals}`;
}

export interface SetupWriter {
  /** Upsert the server's row with these columns. */
  save(change: Partial<GuildSettings>): Promise<void>;
}

/** Saves a change and returns the (ephemeral) reply and the settings now in effect. */
export async function applySetup(
  writer: SetupWriter,
  current: GuildSettings,
  change: Partial<GuildSettings> | string | null,
): Promise<{ reply: string; settings: GuildSettings }> {
  if (typeof change === "string") return { reply: change, settings: current };
  if (change === null) return { reply: settingsText(current), settings: current };
  try {
    await writer.save(change);
  } catch (err) {
    console.error("setup failed:", err);
    return { reply: "Something went wrong, nothing was changed. Please try again later.", settings: current };
  }
  const settings = { ...current, ...change };
  return { reply: `Saved.\n${settingsText(settings)}`, settings };
}
