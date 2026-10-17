import type { MemberRow } from "./activity.js";

/** Slash commands registered for our guild; plain data so it can be sent as-is to Discord. */
export const VISIBILITY_COMMANDS = [
  { name: "hide-me", description: "Hide yourself from the public ni han bao website" },
  { name: "show-me", description: "Show yourself on the public ni han bao website again" },
] as const;

/** The hidden flag a command sets, or null if it is not one of ours. */
export function hiddenFor(commandName: string): boolean | null {
  if (commandName === "hide-me") return true;
  if (commandName === "show-me") return false;
  return null;
}

export interface VisibilityWriter {
  /** Create the member's row if needed and set its hidden flag. */
  setHidden(member: MemberRow, hidden: boolean): Promise<void>;
}

/** Apply the flag and return the (ephemeral) reply for the caller. */
export async function setVisibility(
  writer: VisibilityWriter,
  member: MemberRow,
  hidden: boolean,
): Promise<string> {
  try {
    await writer.setHidden(member, hidden);
  } catch (err) {
    console.error("visibility update failed:", err);
    return "Something went wrong, nothing was changed. Please try again later.";
  }
  return hidden
    ? "You are now hidden from the website. Use /show-me to appear again."
    : "You are visible on the website again. Use /hide-me to hide.";
}
