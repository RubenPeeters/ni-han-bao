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
  "ni-han-bao was created under Riot Games' \"Legal Jibber Jabber\" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.";
