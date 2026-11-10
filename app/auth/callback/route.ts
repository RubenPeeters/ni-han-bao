import { nextPath } from "@/lib/next-path";
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
  // Always behind our own origin: nextPath only lets through paths on this site.
  return NextResponse.redirect(`${origin}${nextPath(searchParams.get("next"))}`);
}
