import { legacyPath } from "@/lib/legacy";
import { createClient } from "@/lib/supabase/server";
import { hasEnvVars } from "@/lib/utils";
import { notFound } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";

/**
 * The route's server id, once the visitor is known to be a member. Anyone else gets a 404,
 * so a server they are not in looks the same as one that does not exist. Call it from every
 * page, not from a layout: layouts do not re-render on navigation.
 */
export async function memberGuild(params: Promise<{ guildId: string }>) {
  const { guildId } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_guild_member", { g: guildId });
  if (error) throw new Error(`is_guild_member failed: ${error.message}`);
  if (!data) notFound();
  return guildId;
}

/** The server's time zone from /setup timezone; UTC until someone sets one. Call after memberGuild(). */
export async function guildTimeZone(guildId: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("guild_settings").select("timezone").eq("guild_id", guildId).maybeSingle();
  if (error) throw new Error(`guild_settings failed: ${error.message}`);
  return data?.timezone ?? "UTC";
}

/** GET handler for an old single-server URL; logged-out visitors land on the picker's login. */
export function redirectToServer(page: string) {
  return async (request: NextRequest) => {
    let ids: string[] = [];
    if (hasEnvVars) {
      const supabase = await createClient();
      const { data } = await supabase.rpc("my_guilds");
      ids = (data ?? []).map((g: { guild_id: string }) => g.guild_id);
    }
    return NextResponse.redirect(new URL(legacyPath(ids, page), request.nextUrl.origin));
  };
}
