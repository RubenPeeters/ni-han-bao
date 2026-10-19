import { setLending } from "@/app/u/[userId]/actions";
import { ProfileHeader, type Profile } from "@/components/profile-stats";
import { EmptyState, ErrorState, RankList, RankRow, StatCard, StatGrid } from "@/components/stat-ui";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";

interface Total {
  set_code: string;
  rarity: string;
  copies: number;
  printings: number;
}

const DEFAULTS = [
  { value: "none", label: "Nothing until I mark cards", hint: "Set a count per card with To lend on the Cards page." },
  { value: "all", label: "Everything I own", hint: "Per-card counts still override it." },
];

/** A profile's Collection tab; profile() and profile_collection() check can_see_profile(). */
export async function ProfileCollection({ user }: { user: string }) {
  const supabase = await createClient();
  const [profile, totals] = await Promise.all([
    supabase.rpc("profile", { u: user }).maybeSingle<Profile>(),
    supabase.rpc("profile_collection", { u: user }),
  ]);
  if (profile.error || totals.error) return <ErrorState title="Could not load this collection">Try again in a minute.</ErrorState>;
  // Private, hidden, forgotten or unknown: the same 404 as the Activity tab.
  if (!profile.data) notFound();
  const { mine } = profile.data;
  const lending = mine ? await supabase.from("profiles").select("lends_cards, lend_all").eq("user_id", user).maybeSingle() : null;
  if (lending?.error) return <ErrorState title="Could not load this collection">Try again in a minute.</ErrorState>;
  const rows = totals.data as Total[];
  const sum = (key: "set_code" | "rarity") => {
    const by = new Map<string, { copies: number; printings: number }>();
    for (const r of rows) {
      const t = by.get(r[key]) ?? { copies: 0, printings: 0 };
      by.set(r[key], { copies: t.copies + r.copies, printings: t.printings + r.printings });
    }
    return [...by].sort((a, b) => b[1].copies - a[1].copies || a[0].localeCompare(b[0]));
  };
  const copies = rows.reduce((n, r) => n + r.copies, 0);
  return (
    <>
      <ProfileHeader
        user={user}
        profile={profile.data}
        subtitle={mine ? "Your Riftbound cards." : "Their Riftbound cards."}
      />
      {mine && <LendingForm lends={lending?.data?.lends_cards ?? false} lendAll={lending?.data?.lend_all ?? false} />}
      {rows.length === 0 ? (
        <EmptyState>
          {mine ? (
            <>
              No cards yet. Add them on the <Link href="/cards" className="underline underline-offset-4">Cards</Link> page
              with Edit my collection, or with /collection add in Discord.
            </>
          ) : (
            "No cards recorded yet."
          )}
        </EmptyState>
      ) : (
        <StatGrid>
          {[
            { title: "Per set", key: "set_code" as const },
            { title: "Per rarity", key: "rarity" as const },
          ].map(({ title, key }) => (
            <StatCard key={key} title={title} description={`${copies.toLocaleString("en-US")} copies in all`}>
              <RankList>
                {sum(key).map(([label, t], i) => (
                  <RankRow key={label} rank={i + 1} value={t.copies.toLocaleString("en-US")}>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{label}</span>
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
      )}
    </>
  );
}

function LendingForm({ lends, lendAll }: { lends: boolean; lendAll: boolean }) {
  return (
    <form action={setLending} className="card flex flex-col gap-4">
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="lends" defaultChecked={lends} className="mt-0.5 size-4 accent-primary" />
        <span className="flex flex-col">
          <span className="font-medium">I lend cards</span>
          <span className="text-muted-foreground">
            Members of your servers see your copies to lend under Who has it? on a card&apos;s page. Off: nobody does.
          </span>
        </span>
      </label>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-medium">What I lend</legend>
        {DEFAULTS.map((d) => (
          <label key={d.value} className="flex items-start gap-3 text-sm">
            <input
              type="radio"
              name="default"
              value={d.value}
              defaultChecked={(d.value === "all") === lendAll}
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="flex flex-col">
              <span className="font-medium">{d.label}</span>
              <span className="text-muted-foreground">{d.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-muted-foreground">
        Also with /collection lending in Discord. A private profile is never listed.
      </p>
      <Button type="submit" size="sm" className="self-start">
        Save
      </Button>
    </form>
  );
}
