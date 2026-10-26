import { createClient } from "@/lib/supabase/server";
import { cache } from "react";

// Cached per request: /collection asks twice, for its header button and its content.
/** The visitor's Discord id for their own Riftbound pages: null when logged out, an error when the lookup failed. */
export const myDiscordId = cache(async () => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return { me: null, error: null };
  const { data, error } = await supabase.rpc("current_discord_id");
  return { me: (data as string | null) ?? null, error };
});
