import { createClient } from "@/lib/supabase/server";

/** The visitor's Discord id for their own Riftbound pages: null when logged out, an error when the lookup failed. */
export async function myDiscordId() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return { me: null, error: null };
  const { data, error } = await supabase.rpc("current_discord_id");
  return { me: (data as string | null) ?? null, error };
}
