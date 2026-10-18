"use client";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { hasEnvVars } from "@/lib/utils";
import type { User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

export function AuthButton() {
  // undefined until the session is read, so a logged-in visitor never sees "Log in" flash.
  const [user, setUser] = useState<User | null>();

  useEffect(() => {
    if (!hasEnvVars) return;
    const { data } = createClient().auth.onAuthStateChange((_event, session) =>
      setUser(session?.user ?? null),
    );
    return () => data.subscription.unsubscribe();
  }, []);

  if (user === undefined) return null;

  if (!user) {
    return (
      <Button
        size="sm"
        onClick={() =>
          // No `scopes`: Supabase always asks Discord for `identify email`, and membership
          // comes from the bot, so the `guilds` scope is not needed.
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
      <span className="truncate text-sm">{name}</span>
      <Button size="sm" variant="ghost" onClick={() => void createClient().auth.signOut()}>
        Log out
      </Button>
    </div>
  );
}
