"use client";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { hasEnvVars } from "@/lib/utils";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// undefined until the session is read, so a logged-in visitor never sees "Log in" flash.
// Without Supabase there is no session to read: logged out, so screenshots show the button.
function useUser() {
  const [user, setUser] = useState<User | null | undefined>(hasEnvVars ? undefined : null);
  const router = useRouter();

  useEffect(() => {
    if (!hasEnvVars) return;
    const { data } = createClient().auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      // Server-rendered server pages were read with the old session; re-render them as anon.
      if (event === "SIGNED_OUT") router.refresh();
    });
    return () => data.subscription.unsubscribe();
  }, [router]);

  return user;
}

export function LoginButton({ size }: { size: "sm" | "lg" }) {
  return (
    <Button
      size={size}
      onClick={() =>
        // No `scopes`: Supabase's Discord provider always asks for `identify email` and only
        // appends extra scopes, so identify-only is not possible without a custom OAuth flow.
        // Membership comes from the bot, so the `guilds` scope is not needed.
        void createClient().auth.signInWithOAuth({
          provider: "discord",
          options: { redirectTo: `${location.origin}/auth/callback` },
        })
      }
    >
      Log in with Discord
    </Button>
  );
}

/** The page's call to action: log in, or go to your servers once logged in. */
export function ServersButton() {
  const user = useUser();
  if (user === undefined) return null;
  if (!user) return <LoginButton size="lg" />;
  return (
    <Button asChild size="lg">
      <Link href="/s">See your servers</Link>
    </Button>
  );
}

export function AuthButton() {
  const user = useUser();

  if (user === undefined) return null;

  if (!user) return <LoginButton size="sm" />;

  const meta = user.user_metadata;
  const name: string = meta.custom_claims?.global_name ?? meta.full_name ?? meta.name ?? "Discord user";
  return (
    <div className="flex min-w-0 items-center gap-2">
      {meta.avatar_url && (
        // Same as the leaderboard: Discord CDN avatars are already small.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={meta.avatar_url}
          alt=""
          width={28}
          height={28}
          className="size-7 shrink-0 rounded-full bg-muted object-cover"
        />
      )}
      <span className="hidden truncate text-sm sm:inline">{name}</span>
      {/* Only a link target: the profile page itself checks who is logged in. */}
      <Button asChild size="sm" variant="ghost">
        <Link href={`/u/${meta.provider_id ?? meta.sub}`}>My profile</Link>
      </Button>
      <Button size="sm" variant="ghost" onClick={() => void createClient().auth.signOut()}>
        Log out
      </Button>
    </div>
  );
}
