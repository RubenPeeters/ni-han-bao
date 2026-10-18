import { createBrowserClient } from "@supabase/ssr";

// The site has no proxy (scripts/check-public-pages.mjs), so this client is what refreshes
// the session: it renews the token while a page is open and writes the auth cookies.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
