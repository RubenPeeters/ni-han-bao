import { SET_NAMES } from "@/bot/src/card-match";
import { riftboundIcons } from "@/components/card-library";
import { ProfileHeader, SettingsLink, type Profile } from "@/components/profile-stats";
import { RarityIcon } from "@/components/riftbound-icons";
import { EmptyState, ErrorState, RankList, RankRow, StatCard, StatGrid } from "@/components/stat-ui";
import { languageName } from "@/lib/collection";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";

/** A row per set and rarity (language null), or per language (set and rarity null). */
interface Total {
  set_code: string;
  rarity: string;
  language: string | null;
  copies: number;
  printings: number;
}

/**
 * A profile's Collection tab; profile() and profile_collection() check can_see_profile().
 * `own`: only the totals, as the summary under the grid on /collection.
 */
export async function ProfileCollection({ user, own }: { user: string; own?: boolean }) {
  const supabase = await createClient();
  const [profile, totals, icons] = await Promise.all([
    supabase.rpc("profile", { u: user }).maybeSingle<Profile>(),
    supabase.rpc("profile_collection", { u: user }),
    riftboundIcons(supabase),
  ]);
  if (profile.error || totals.error) return <ErrorState title="Could not load this collection">Try again in a minute.</ErrorState>;
  // Private, hidden, forgotten or unknown: the same 404 as the Activity tab.
  if (!profile.data) notFound();
  const { mine } = profile.data;
  const lending = mine && !own ? await supabase.from("profiles").select("lends_cards, lend_all").eq("user_id", user).maybeSingle() : null;
  if (lending?.error) return <ErrorState title="Could not load this collection">Try again in a minute.</ErrorState>;
  const all = totals.data as Total[];
  const rows = all.filter((r) => r.language === null);
  const sum = (key: "set_code" | "rarity" | "language") => {
    const by = new Map<string, { copies: number; printings: number }>();
    for (const r of key === "language" ? all.filter((r) => r.language !== null) : rows) {
      const label = key === "language" ? languageName(r.language!) : r[key];
      const t = by.get(label) ?? { copies: 0, printings: 0 };
      by.set(label, { copies: t.copies + r.copies, printings: t.printings + r.printings });
    }
    return [...by].sort((a, b) => b[1].copies - a[1].copies || a[0].localeCompare(b[0]));
  };
  const copies = rows.reduce((n, r) => n + r.copies, 0);
  // The grid above already says when there are no cards.
  if (own && rows.length === 0) return null;
  const grid = (
    <StatGrid>
      {[
        { title: "Per set", key: "set_code" as const },
        { title: "Per rarity", key: "rarity" as const },
        { title: "Per language", key: "language" as const },
      ].map(({ title, key }) => (
        <StatCard key={key} title={title} description={`${copies.toLocaleString("en-US")} copies in all`}>
          <RankList>
            {sum(key).map(([label, t], i) => (
              <RankRow key={label} rank={i + 1} value={t.copies.toLocaleString("en-US")}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">
                    {key === "rarity" ? (
                      <RarityIcon icons={icons} rarity={label} withText />
                    ) : key === "set_code" && SET_NAMES[label] ? (
                      `${label} · ${SET_NAMES[label]}`
                    ) : (
                      label
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t.printings.toLocaleString("en-US")} different {t.printings === 1 ? "card" : "cards"}
                  </span>
                </span>
              </RankRow>
            ))}
          </RankList>
        </StatCard>
      ))}
    </StatGrid>
  );
  if (own) return grid;
  return (
    <>
      <ProfileHeader
        user={user}
        profile={profile.data}
        subtitle={mine ? "Your Riftbound cards." : "Their Riftbound cards."}
        manage="/collection"
      />
      {mine && (
        <SettingsLink href="/settings#riftbound">
          {!lending?.data?.lends_cards ? "You do not lend cards." : lending.data.lend_all ? "You lend everything you own." : "You lend the cards you mark."}
        </SettingsLink>
      )}
      {rows.length === 0 ? (
        <EmptyState>
          {mine ? (
            <>
              No cards yet. Add them on the <Link href="/cards" className="text-crystal underline underline-offset-4 hover:text-crystal/80">Cards</Link> page
              with Edit my collection, or with /collection add in Discord.
            </>
          ) : (
            "No cards recorded yet."
          )}
        </EmptyState>
      ) : (
        grid
      )}
    </>
  );
}
