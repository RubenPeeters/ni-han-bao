import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// This check can be removed, it is just for tutorial purposes
export const hasEnvVars =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// Riot's Legal Jibber Jabber policy (section 6) requires this exact statement, easy to find.
export const RIOT_DISCLAIMER =
  "nexus was created under Riot Games' \"Legal Jibber Jabber\" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.";

// View Channels, Send Messages, Embed Links (the report cards), Attach Files (the monthly
// recap image) and Read Message History (counting past messages). Slash commands need the
// applications.commands scope.
export const INSTALL_URL =
  "https://discord.com/oauth2/authorize?client_id=1561027678838980680&permissions=117760&scope=bot+applications.commands";
