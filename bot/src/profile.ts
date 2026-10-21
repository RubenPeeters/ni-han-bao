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
