import { createClient } from "@supabase/supabase-js";

/**
 * Anonymous client without cookies, for stats cached across visitors ("use cache" cannot
 * read cookies, and a cached result is shared by everyone). Never read anything with a
 * user's session through a cached scope; key caches by public inputs like the guild id.
 */
export function createPublicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
