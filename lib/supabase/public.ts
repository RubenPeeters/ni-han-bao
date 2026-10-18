import { createClient } from "@supabase/supabase-js";

/**
 * Anonymous client without cookies, for stats cached across visitors ("use cache" scopes
 * cannot read cookies). Never use it for anything read with a user's session: a cached
 * result is shared by everyone, so cache keys must only vary by public inputs like guild id.
 */
export function createPublicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
