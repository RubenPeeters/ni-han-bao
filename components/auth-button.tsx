"use client";

import { ThemeRadioGroup, ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import { cn, hasEnvVars } from "@/lib/utils";
import type { User } from "@supabase/supabase-js";
import { CircleUserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// undefined until the session is read, so a logged-in visitor never sees "Log in" flash.
// Without Supabase there is no session to read: logged out, so screenshots show the button.
export function useUser() {
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

/** The member's Discord id, which their /u/ pages use. */
export const discordId = (user: User) => user.user_metadata.provider_id ?? user.user_metadata.sub;

// No `scopes`: Supabase's Discord provider always asks for `identify email` and only
// appends extra scopes, so identify-only is not possible without a custom OAuth flow.
// Membership comes from the bot, so the `guilds` scope is not needed.
const logIn = () =>
  void createClient().auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: `${location.origin}/auth/callback` },
  });

export function LoginButton({ size }: { size: "sm" | "lg" }) {
  return (
    <Button size={size} onClick={logIn}>
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

// 44px to tap, around a 32px avatar; the negative margin keeps the avatar flush with the edge.
const trigger =
  "-mr-1.5 flex size-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The header's right side: log in and theme, or the member's avatar with their account menu. */
export function AuthButton() {
  const user = useUser();

  // Holds the avatar's place, so the header does not shift once the session is read.
  if (user === undefined) return <div className="size-11" />;

  if (!user) {
    return (
      <>
        <div className="hidden items-center gap-1 sm:flex">
          <LoginButton size="sm" />
          <ThemeSwitcher />
        </div>
        {/* On a phone the header has room for one control here, so log in and theme share a
            menu in the account menu's place. */}
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="Log in and theme" className={cn(trigger, "sm:hidden")}>
            <CircleUserRound aria-hidden className="size-6 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={logIn}>Log in with Discord</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Theme</DropdownMenuLabel>
            <ThemeRadioGroup />
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    );
  }

  const meta = user.user_metadata;
  const name: string = meta.custom_claims?.global_name ?? meta.full_name ?? meta.name ?? "Discord user";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu for ${name}`}
        className={trigger}
      >
        {meta.avatar_url ? (
          // Same as the leaderboard: Discord CDN avatars are already small.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={meta.avatar_url} alt="" className="size-8 rounded-full bg-muted object-cover" />
        ) : (
          <span className="flex size-8 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="truncate">{name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* Only a link target: the profile page itself checks who is logged in. */}
        <DropdownMenuItem asChild>
          <Link href={`/u/${discordId(user)}`}>My profile</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Theme</DropdownMenuLabel>
        <ThemeRadioGroup />
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void createClient().auth.signOut()}>Log out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
