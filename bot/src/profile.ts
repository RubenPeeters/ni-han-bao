import { ApplicationCommandOptionType } from "discord.js";

export const VISIBILITIES = ["private", "members", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

const LABELS: Record<Visibility, string> = {
  private: "Private",
  members: "Server members",
  public: "Public",
};

const WHO: Record<Visibility, string> = {
  private: "only you",
  members: "people who share a server with you, for the servers you share",
  public: "anyone logged in to the website",
};

export const PROFILE_COMMAND = {
  name: "profile",
  description: "Your nexus profile page",
  options: [
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "visibility",
      description: "Who can see your profile page on the website",
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: "level",
          description: "Who can see it",
          required: true,
          choices: VISIBILITIES.map((value) => ({ name: `${LABELS[value]}: ${WHO[value]}`, value })),
        },
      ],
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: "champion",
      description: "Your favourite League champion on your profile; leave it out to clear it",
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: "champion",
          description: "The champion",
          autocomplete: true,
        },
      ],
    },
  ],
} as const;

/** A champion from Data Dragon's champion.json: its id ("MonkeyKing") and name ("Wukong"). */
export interface Champion {
  id: string;
  name: string;
}

// Case, accents, spaces and punctuation ignored: "kai sa", "Kai'Sa" and "KaiSa" are one champion.
const normal = (s: string) => s.normalize("NFD").toLowerCase().replace(/[^a-z0-9]/g, "");

/** A typed name or id to the champion's id, or null when it is none. */
export function matchChampion(champions: readonly Champion[], typed: string): string | null {
  const q = normal(typed);
  return champions.find((c) => normal(c.id) === q || normal(c.name) === q)?.id ?? null;
}

/** The autocomplete's suggestions: names containing what was typed, those starting with it first. */
export function championChoices(champions: readonly Champion[], typed: string): { name: string; value: string }[] {
  const q = normal(typed);
  const starts = (c: Champion) => (normal(c.name).startsWith(q) ? 0 : 1);
  return champions
    .filter((c) => normal(c.name).includes(q) || normal(c.id).includes(q))
    .sort((a, b) => starts(a) - starts(b) || a.name.localeCompare(b.name))
    .slice(0, 25)
    .map((c) => ({ name: c.name, value: c.id }));
}

export interface ProfileWriter {
  /** Create or update the user's profiles row; false when the database skipped it (forgotten user). */
  setVisibility(userId: string, visibility: Visibility): Promise<boolean>;
  /** The same for the favourite champion's id; null clears it. */
  setChampion(userId: string, champion: string | null): Promise<boolean>;
}

/** Apply the choice and return the (ephemeral) reply; `level` is the raw option value. */
export async function setProfileVisibility(
  writer: Pick<ProfileWriter, "setVisibility">,
  userId: string,
  level: string,
  siteUrl: string | null,
): Promise<string> {
  // Discord only sends the registered choices, but the option is still caller input.
  const visibility = VISIBILITIES.find((v) => v === level);
  if (!visibility) return "Unknown visibility, nothing was changed.";
  try {
    if (!(await writer.setVisibility(userId, visibility))) {
      return "You asked to be forgotten, so nothing was saved. Use /show-me first.";
    }
  } catch (err) {
    console.error("profile visibility update failed:", err);
    return "Something went wrong, nothing was changed. Please try again later.";
  }
  const reply = `Your profile is now ${LABELS[visibility]}: ${WHO[visibility]} can see it.`;
  return siteUrl ? `${reply} ${siteUrl}/u/${userId}` : reply;
}

/** /profile champion: `typed` is the option (a suggestion's id or a typed name), null clears it. */
export async function setFavouriteChampion(
  writer: Pick<ProfileWriter, "setChampion">,
  champions: readonly Champion[],
  userId: string,
  typed: string | null,
  siteUrl: string | null,
): Promise<string> {
  const id = typed === null ? null : matchChampion(champions, typed);
  if (typed !== null && !id) {
    return champions.length
      ? `No champion called "${typed.slice(0, 100)}". Pick one from the suggestions.`
      : "Could not load the champion list, nothing was changed. Please try again later.";
  }
  try {
    if (!(await writer.setChampion(userId, id))) {
      return "You asked to be forgotten, so nothing was saved. Use /show-me first.";
    }
  } catch (err) {
    console.error("favourite champion update failed:", err);
    return "Something went wrong, nothing was changed. Please try again later.";
  }
  const reply = id
    ? `Your favourite champion is now ${champions.find((c) => c.id === id)!.name}.`
    : "Your favourite champion is cleared.";
  return siteUrl ? `${reply} ${siteUrl}/u/${userId}` : reply;
}
