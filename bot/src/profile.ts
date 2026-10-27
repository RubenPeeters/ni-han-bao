import { ApplicationCommandOptionType } from "discord.js";
import { findChampion, type Champion } from "./champions.js";

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
          description: "Start typing its name",
          required: false,
          autocomplete: true,
          max_length: 40,
        },
      ],
    },
  ],
} as const;

export interface ProfileWriter {
  /** Create or update the user's profiles row; false when the database skipped it (forgotten user). */
  setVisibility(userId: string, visibility: Visibility): Promise<boolean>;
}

/** Apply the choice and return the (ephemeral) reply; `level` is the raw option value. */
export async function setProfileVisibility(
  writer: ProfileWriter,
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

export interface FavouriteWriter {
  /** Set or clear (null) the user's favourite champion id; false when the database skipped it (forgotten user). */
  setFavourite(userId: string, championId: string | null): Promise<boolean>;
}

/** /profile champion: `typed` is the option (an id from autocomplete, or a typed name), null clears. */
export async function setFavouriteChampion(
  writer: FavouriteWriter,
  userId: string,
  typed: string | null,
  champions: () => Promise<Champion[]>,
  siteUrl: string | null,
): Promise<string> {
  let champion: Champion | null = null;
  if (typed) {
    try {
      champion = findChampion(await champions(), typed);
    } catch (err) {
      console.error("champion list failed:", err);
      return "Could not load the champions from Riot, nothing was changed. Please try again later.";
    }
    if (!champion) return "No champion by that name, nothing was changed. Pick one from the list.";
  }
  try {
    if (!(await writer.setFavourite(userId, champion?.id ?? null))) {
      return "You asked to be forgotten, so nothing was saved. Use /show-me first.";
    }
  } catch (err) {
    console.error("favourite champion update failed:", err);
    return "Something went wrong, nothing was changed. Please try again later.";
  }
  const reply = champion ? `Your favourite champion is now ${champion.name}.` : "You no longer have a favourite champion.";
  return siteUrl ? `${reply} ${siteUrl}/u/${userId}` : reply;
}
