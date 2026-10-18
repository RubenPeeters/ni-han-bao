import { ApplicationCommandOptionType } from "discord.js";

export const DEFAULT_GAME = "Riftbound";

const storeOption = {
  type: ApplicationCommandOptionType.Integer,
  name: "store",
  description: "Start typing its name or city",
  required: true,
  autocomplete: true,
} as const;

export const STORE_COMMAND = {
  name: "store",
  description: "The local game stores this server plays at",
  options: [
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "add",
      description: "Add a store this server plays at",
      options: [
        { type: ApplicationCommandOptionType.String, name: "name", description: "The store's name", required: true, max_length: 100 },
        { type: ApplicationCommandOptionType.String, name: "city", description: "Its city (no address)", required: true, max_length: 100 },
        { type: ApplicationCommandOptionType.String, name: "link", description: "Its PlayRiftbound page, or another https link", max_length: 300 },
        { type: ApplicationCommandOptionType.String, name: "game", description: `The game played there (default ${DEFAULT_GAME})`, max_length: 50 },
      ],
    },
    { type: ApplicationCommandOptionType.Subcommand, name: "list", description: "List this server's stores" },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "remove",
      description: "Remove a store (the member who added it, or Manage Server)",
      options: [storeOption],
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "mine",
      description: "Mark a store as one of your regulars, or unmark it",
      options: [storeOption],
    },
  ],
} as const;

export interface Store {
  id: number;
  game: string;
  name: string;
  city: string;
  url: string | null;
  added_by: string | null;
}

export type NewStore = Pick<Store, "game" | "name" | "city" | "url">;

/** The row /store add writes, or why it cannot. Options come from Discord, so they are untrusted. */
export function newStore(input: { name: string; city: string; link: string | null; game: string | null }): NewStore | string {
  const name = input.name.trim();
  const city = input.city.trim();
  const game = input.game?.trim() || DEFAULT_GAME;
  if (!name || !city) return "Give the store a name and a city.";
  let url: string | null = null;
  if (input.link?.trim()) {
    try {
      const parsed = new URL(input.link.trim());
      // The site renders it as a link: anything but https (javascript:, data:, http) stays out.
      if (parsed.protocol !== "https:") throw new Error("not https");
      url = parsed.href;
    } catch {
      return "The link must be a full https:// address, like https://playriftbound.com/...";
    }
  }
  return { game, name, city, url };
}

export function storeLabel(store: Pick<Store, "game" | "name" | "city">): string {
  return store.game === DEFAULT_GAME ? `${store.name} (${store.city})` : `${store.name} (${store.city}, ${store.game})`;
}

/** Autocomplete choices for the store option: matches on name, city or game, at most 25 (Discord's limit). */
export function storeChoices(stores: Store[], typed: string): { name: string; value: number }[] {
  const query = typed.trim().toLowerCase();
  return stores
    .filter((s) => !query || storeLabel(s).toLowerCase().includes(query))
    .slice(0, 25)
    // Discord caps a choice's name at 100 characters.
    .map((s) => ({ name: storeLabel(s).slice(0, 100), value: s.id }));
}

export function canRemove(store: Pick<Store, "added_by">, userId: string, manageGuild: boolean): boolean {
  return manageGuild || store.added_by === userId;
}

/** The /store list reply: one line per store, with its link. */
export function storeList(stores: Store[], siteUrl: string | null, guildId: string): string {
  if (stores.length === 0) return "No stores yet. Add one with /store add.";
  // <> keeps Discord from unfurling a preview per store.
  const lines = stores.map((s) => `- **${escapeMarkdown(storeLabel(s))}**${s.url ? ` <${s.url}>` : ""}`);
  const page = siteUrl ? `: <${siteUrl}/s/${guildId}/stores>` : "";
  const text = `Where we play (mark yours with /store mine)${page}\n${lines.join("\n")}`;
  // shortcut: a long list is cut at Discord's 2000 characters; page it if servers add that many.
  return text.length <= 2000 ? text : `${text.slice(0, 1997)}...`;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\*_~`|>[\]()]/g, "\\$&");
}
