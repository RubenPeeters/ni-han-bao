// Onboarding (#307): admins offer roles with /setup onboarding; the bot DMs each member who
// joins once, with a picker of those roles, and /roles shows the same picker in the server.

import {
  ButtonStyle,
  ComponentType,
  PermissionFlagsBits,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIComponentInMessageActionRow,
} from "discord.js";
import { escapeMarkdown } from "./stores.js";

/** One Discord select menu holds at most 25 options. */
export const MAX_OFFERED = 25;

export const ROLES_COMMAND = {
  name: "roles",
  description: "Pick the roles this server offers",
} as const;

/** A role offered in the picker, one onboarding_roles row. */
export interface OfferedRole {
  role_id: string;
  label: string;
}

/** What eligibility needs to know about a Discord role. */
export interface RoleFacts {
  name: string;
  position: number;
  managed: boolean;
  everyone: boolean;
  permissions: bigint;
}

// A role members pick themselves must never grant power.
const DANGEROUS: [bigint, string][] = [
  [PermissionFlagsBits.Administrator, "Administrator"],
  [PermissionFlagsBits.ManageGuild, "Manage Server"],
  [PermissionFlagsBits.ManageRoles, "Manage Roles"],
  [PermissionFlagsBits.ManageChannels, "Manage Channels"],
  [PermissionFlagsBits.ManageMessages, "Manage Messages"],
  [PermissionFlagsBits.KickMembers, "Kick Members"],
  [PermissionFlagsBits.BanMembers, "Ban Members"],
  [PermissionFlagsBits.ModerateMembers, "Timeout Members"],
  [PermissionFlagsBits.MentionEveryone, "Mention Everyone"],
];

/** Why the bot may not offer this role, or null when it may. Checked on role-add and again before every change. */
export function roleProblem(role: RoleFacts, bot: { canManageRoles: boolean; position: number }): string | null {
  const name = escapeMarkdown(role.name);
  if (role.everyone) return "@everyone cannot be offered: every member has it already.";
  if (role.managed) return `${name} is managed by an integration, so I cannot give it.`;
  const powers = DANGEROUS.filter(([bit]) => (role.permissions & bit) !== 0n).map(([, label]) => label);
  if (powers.length) {
    return `${name} cannot be offered: it has ${powers.join(", ")}, and a role members pick themselves must never grant power. Remove ${powers.length === 1 ? "that permission" : "those permissions"} and try again.`;
  }
  if (!bot.canManageRoles) return "I need the Manage Roles permission to give roles. Give my role that permission and try again.";
  if (role.position >= bot.position) return `My role must be above ${name} to give it. Move my role up in Server Settings > Roles and try again.`;
  return null;
}

/** The roles offered after role-add, or why the role is refused. A role offered already gets the new label. */
export function addRole(
  current: readonly OfferedRole[],
  role: { id: string; name: string },
  label: string | null,
  problem: string | null,
): OfferedRole[] | string {
  if (problem) return problem;
  const offered = { role_id: role.id, label: label?.trim() || role.name };
  if (current.some((r) => r.role_id === role.id)) return current.map((r) => (r.role_id === role.id ? offered : r));
  if (current.length >= MAX_OFFERED) return `At most ${MAX_OFFERED} roles fit in the picker. Remove one with /setup onboarding role-remove first.`;
  return [...current, offered];
}

/** The roles offered after role-remove, or why nothing changed. */
export function removeRole(current: readonly OfferedRole[], role: { id: string; name: string }): OfferedRole[] | string {
  if (!current.some((r) => r.role_id === role.id)) return `${escapeMarkdown(role.name)} is not offered.`;
  return current.filter((r) => r.role_id !== role.id);
}

/** The onboarding line of /setup show. */
export function onboardingText(on: boolean, roles: readonly OfferedRole[]): string {
  const offered = roles.length ? `offers ${roles.map((r) => escapeMarkdown(r.label)).join(", ")}` : "no roles offered yet (add them with /setup onboarding role-add)";
  return `Onboarding: ${on ? "on" : "off"}, ${offered}`;
}

const PICK_ID = /^onboard-(roles|no):(\d+)$/;
export const pickerId = (guildId: string) => `onboard-roles:${guildId}`;
export const noThanksId = (guildId: string) => `onboard-no:${guildId}`;
/** The server a picker or No thanks belongs to: a DM has no server of its own. */
export function parseOnboardingId(customId: string): { kind: "roles" | "no"; guildId: string } | null {
  const m = PICK_ID.exec(customId);
  return m ? { kind: m[1] as "roles" | "no", guildId: m[2] } : null;
}

type Row = APIActionRowComponent<APIComponentInMessageActionRow>;

/** The multi-select of the offered roles, the member's current ones ticked: unticking one removes it. */
export function rolePicker(guildId: string, roles: readonly OfferedRole[], held: ReadonlySet<string>): Row {
  return {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.StringSelect,
        custom_id: pickerId(guildId),
        placeholder: "Pick your roles",
        min_values: 0,
        max_values: roles.length,
        options: roles.map((r) => ({ label: r.label, value: r.role_id, default: held.has(r.role_id) })),
      },
    ],
  };
}

/** The one DM to a member who joined. */
export function onboardingDm(
  guild: { id: string; name: string },
  roles: readonly OfferedRole[],
  held: ReadonlySet<string>,
  siteUrl: string | null,
): { content: string; components: Row[] } {
  const buttons: APIButtonComponent[] = [
    ...(siteUrl ? [{ type: ComponentType.Button, style: ButtonStyle.Link, label: "Pick your favourite champion", url: `${siteUrl}/settings` } as const] : []),
    { type: ComponentType.Button, style: ButtonStyle.Secondary, label: "No thanks", custom_id: noThanksId(guild.id) },
  ];
  return {
    content: `Welcome to **${escapeMarkdown(guild.name)}**! Pick the roles you want below. You can change them any time with /roles in the server.`,
    components: [rolePicker(guild.id, roles, held), { type: ComponentType.ActionRow, components: buttons }],
  };
}

/** /roles: the same picker, only for the member who asked. */
export function rolesReply(guildId: string, roles: readonly OfferedRole[], held: ReadonlySet<string>): { content: string; components: Row[] } {
  return { content: "Pick your roles. Roles you untick are taken away.", components: [rolePicker(guildId, roles, held)] };
}

/** Roles to add and remove so the member has exactly the chosen ones of those offered; others are never touched. */
export function roleDiff(offered: readonly string[], chosen: readonly string[], held: ReadonlySet<string>): { add: string[]; remove: string[] } {
  const want = new Set(chosen);
  return {
    add: offered.filter((id) => want.has(id) && !held.has(id)),
    remove: offered.filter((id) => !want.has(id) && held.has(id)),
  };
}

/** The reply after a pick: what changed. `labels`: role id -> label. */
export function diffText(diff: { add: string[]; remove: string[] }, labels: ReadonlyMap<string, string>): string {
  const names = (ids: string[]) => ids.map((id) => escapeMarkdown(labels.get(id) ?? id)).join(", ");
  if (!diff.add.length && !diff.remove.length) return "Nothing changed: you already have those roles.";
  return [diff.add.length && `Added ${names(diff.add)}.`, diff.remove.length && `Removed ${names(diff.remove)}.`].filter(Boolean).join(" ");
}

export const NO_THANKS = "No problem. If you change your mind, use /roles in the server.";
export const NOT_A_MEMBER = "You are no longer in that server, so nothing was changed.";
export const NO_ROLES = "This server offers no roles to pick.";
