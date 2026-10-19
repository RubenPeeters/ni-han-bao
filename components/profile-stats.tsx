import { setVisibility } from "@/app/u/[userId]/actions";
import { Emoji } from "@/components/emoji-stats";
import { EmptyState, ErrorState } from "@/components/stat-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";

interface Server {
  guild_id: string;
  name: string;
  icon_url: string | null;
  message_count: number;
  voice_seconds: number;
  rank: number | null;
}

interface Profile {
  display_name: string | null;
  avatar_url: string | null;
  visibility: string | null;
  mine: boolean;
}

interface Badges {
  channel_name: string | null;
  channel_guild: string | null;
  emoji_key: string | null;
  emoji_id: string | null;
  emoji_name: string | null;
  emoji_animated: boolean | null;
  longest_streak: number | null;
}

const VISIBILITIES = [
  { value: "private", label: "Private", hint: "Only you." },
  { value: "members", label: "Server members", hint: "People who share a server with you see the servers you share." },
  { value: "public", label: "Public", hint: "Anyone logged in sees your name; people who share a server with you also see your stats and badges there." },
];

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const h = Math.floor(minutes / 60);
  return h ? `${h.toLocaleString("en-US")} h ${minutes % 60} min` : `${minutes} min`;
}

/**
 * One Discord user across servers. The database decides who may see it (profile(),
 * profile_servers(), profile_badges() all check can_see_profile()), so this only renders.
 */
export async function ProfileStats({ user }: { user: string }) {
  const supabase = await createClient();
  const [profile, servers, badges] = await Promise.all([
    supabase.rpc("profile", { u: user }).maybeSingle<Profile>(),
    supabase.rpc("profile_servers", { u: user }),
    supabase.rpc("profile_badges", { u: user }).maybeSingle<Badges>(),
  ]);
  if (profile.error || servers.error || badges.error) {
    return <ErrorState title="Could not load this profile">Try again in a minute.</ErrorState>;
  }
  // Private, hidden, forgotten or unknown: the same 404 as a page that does not exist.
  if (!profile.data) notFound();
  const { display_name, avatar_url, visibility, mine } = profile.data;
  const name = display_name ?? "You";
  const badge = badges.data;
  return (
    <>
      <div className="flex min-w-0 items-center gap-4">
        {avatar_url ? (
          // Discord CDN avatars are already small; same as the leaderboard.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar_url} alt="" width={64} height={64} className="size-16 shrink-0 rounded-full bg-muted object-cover" />
        ) : (
          <span
            aria-hidden
            className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted text-2xl font-semibold text-muted-foreground"
          >
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="truncate text-4xl font-semibold">{name}</h1>
          <p className="text-muted-foreground">
            {mine ? "Your activity in every server you are in." : "Their activity in the servers you share."}
          </p>
        </div>
      </div>
      {badge && (
        <ul className="flex flex-wrap gap-2" aria-label="Badges">
          {badge.channel_name && (
            <li>
              <Badge variant="secondary" className="max-w-full">
                <span className="truncate">
                  Most active in #{badge.channel_name} ({badge.channel_guild})
                </span>
              </Badge>
            </li>
          )}
          {badge.emoji_key && (
            <li>
              <Badge variant="secondary" className="gap-1 py-0">
                Top emoji
                <Emoji
                  row={{
                    emoji_key: badge.emoji_key,
                    emoji_id: badge.emoji_id,
                    name: badge.emoji_name,
                    animated: badge.emoji_animated ?? false,
                    reaction_count: 0,
                  }}
                />
              </Badge>
            </li>
          )}
          {(badge.longest_streak ?? 0) > 0 && (
            <li>
              <Badge variant="secondary">Longest streak: {badge.longest_streak?.toLocaleString("en-US")} days</Badge>
            </li>
          )}
        </ul>
      )}
      {mine && <VisibilityForm current={visibility ?? "private"} />}
      {servers.data.length === 0 ? (
        <EmptyState>{mine ? "The bot is not in any of your servers yet." : "You share no servers with them."}</EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {(servers.data as Server[]).map((s) => (
            <li key={s.guild_id}>
              <Link
                href={`/s/${s.guild_id}/member/${user}`}
                className="card flex min-w-0 flex-col gap-4 active:bg-secondary"
              >
                <span className="flex min-w-0 items-center gap-3">
                  {s.icon_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.icon_url} alt="" width={40} height={40} className="size-10 shrink-0 rounded-full bg-muted object-cover" />
                  ) : (
                    <span
                      aria-hidden
                      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground"
                    >
                      {s.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                </span>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  {[
                    ["Messages", s.message_count.toLocaleString("en-US")],
                    ["Voice", formatSeconds(s.voice_seconds)],
                    ["Rank", s.rank ? `#${s.rank.toLocaleString("en-US")}` : "–"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex min-w-0 flex-col">
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="font-medium tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function VisibilityForm({ current }: { current: string }) {
  return (
    <form action={setVisibility} className="card flex flex-col gap-4">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-lg font-semibold">Who can see this page</legend>
        {VISIBILITIES.map((v) => (
          <label key={v.value} className="flex items-start gap-3 text-sm">
            <input
              type="radio"
              name="visibility"
              value={v.value}
              defaultChecked={v.value === current}
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="flex flex-col">
              <span className="font-medium">{v.label}</span>
              <span className="text-muted-foreground">{v.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-muted-foreground">
        Also with /profile visibility in Discord. While you are hidden with /hide-me, nobody else sees it.
      </p>
      <Button type="submit" size="sm" className="self-start">
        Save
      </Button>
    </form>
  );
}
