/** Slash command registered next to /hide-me and /show-me. */
export const FORGET_COMMAND = {
  name: "forget-me",
  description: "Delete everything ni han bao has stored about you, in every server",
} as const;

export const FORGET_CONFIRM_ID = "forget-me:confirm";
export const FORGET_CANCEL_ID = "forget-me:cancel";

export const FORGET_PROMPT =
  "This deletes everything ni han bao has stored about you, in every server: your message, " +
  "reaction, voice and game time counts, your name and avatar, your membership, your regular stores, the events you are going to, your linked League account with its ranks and games, your Riftbound collection and lending setting, your card loans (gone for the other member too), your profile visibility and your /hide-me setting. " +
  "It cannot be undone. The bot stops counting you until you use /show-me. " +
  "You also lose access to the servers' pages on the website until then.";

export interface ForgetWriter {
  /** Delete every row about the user and record them as forgotten, in one transaction. */
  forget(userId: string): Promise<void>;
}

/** The reply after the confirmation: what was done, or why nothing was. */
export async function forgetMe(writer: ForgetWriter, userId: string, confirmed: boolean): Promise<string> {
  if (!confirmed) return "Cancelled, nothing was deleted.";
  try {
    await writer.forget(userId);
  } catch (err) {
    console.error("forget failed:", err);
    return "Something went wrong, nothing was deleted. Please try again later.";
  }
  return "Done: everything about you is deleted, and the bot no longer counts you. Use /show-me to be counted again.";
}
