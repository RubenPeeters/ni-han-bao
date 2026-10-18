import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

// Discord sends the visitor back here with a one-time code; trading it sets the session cookies.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) console.error("auth callback: code exchange failed", error.message);
  }
  // Always the server picker, never a URL from the query string, so this cannot be an open redirect.
  return NextResponse.redirect(`${origin}/s`);
}
