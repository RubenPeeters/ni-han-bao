import { LendingForm } from "@/components/lending-form";
import { EmptyState, ErrorState, StatCard } from "@/components/stat-ui";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { notFound } from "next/navigation";

interface Total {
  set_code: string;
  rarity: string;
  cards: number;
  copies: number;
}

/** Activity and Collection: the profile's two tabs. */
export function ProfileTabs({ user, current }: { user: string; current: "activity" | "collection" }) {
  const tabs = [
    { key: "activity", href: `/u/${user}`, label: "Activity" },
    { key: "collection", href: `/u/${user}/collection`, label: "Collection" },
  ];
  return (
    <nav aria-label="Profile">
      <ul className="flex gap-1">
        {tabs.map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              aria-current={t.key === current ? "page" : undefined}
              className={cn(
                "block whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-secondary hover:text-foreground active:bg-secondary/60",
                t.key === current ? "bg-secondary text-foreground" : "text-muted-foreground",
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const sum = (rows: Total[], key: "set_code" | "rarity") => {
  const out = new Map<string, { cards: number; copies: number }>();
  for (const r of rows) {
    const t = out.get(r[key]) ?? { cards: 0, copies: 0 };
    out.set(r[key], { cards: t.cards + Number(r.cards), copies: t.copies + Number(r.copies) });
  }
  return [...out];
};

/**
 * A member's Riftbound collection, totals per set and rarity. Who may see it is the profile's
 * visibility, checked in the database (profile() and the collection's policy).
 */
export async function ProfileCollection({ user }: { user: string }) {
  const supabase = await createClient();
  const [profile, totals] = await Promise.all([
    supabase.rpc("profile", { u: user }).maybeSingle<{ display_name: string | null; mine: boolean }>(),
    supabase.rpc("profile_collection", { u: user }),
  ]);
  if (profile.error || totals.error) return <ErrorState title="Could not load this collection">Try again in a minute.</ErrorState>;
  // Private, hidden, forgotten or unknown: the same 404 as the profile.
  if (!profile.data) notFound();
  const { display_name, mine } = profile.data;
  // Your own row only (the table's policy); a missing row is lending off.
  const lending = mine ? await supabase.from("riftbound_lending").select("lends, lend_default").maybeSingle() : null;
  const rows = totals.data as Total[];
  return (
    <>
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="truncate text-4xl font-semibold">{display_name ?? "You"}</h1>
        <p className="text-muted-foreground">{mine ? "Your Riftbound cards." : "Their Riftbound cards."}</p>
      </div>
      <ProfileTabs user={user} current="collection" />
      {lending && !lending.error && <LendingForm lends={lending.data?.lends ?? false} current={lending.data?.lend_default ?? null} />}
      {rows.length === 0 ? (
        <EmptyState>
          {mine ? (
            <>
              Nothing yet. Add cards with Edit collection on <Link href="/cards" className="underline underline-offset-4">Cards</Link>, or /collection add in Discord.
            </>
          ) : (
            "No cards yet."
          )}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["Per set", "set_code"],
              ["Per rarity", "rarity"],
            ] as const
          ).map(([title, key]) => (
            <StatCard key={key} title={title} description="Different printings and copies owned">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2 text-left font-normal">{key === "set_code" ? "Set" : "Rarity"}</th>
                    <th className="pb-2 text-right font-normal">Printings</th>
                    <th className="pb-2 text-right font-normal">Copies</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sum(rows, key).map(([name, t]) => (
                    <tr key={name}>
                      <td className="py-2">{name}</td>
                      <td className="py-2 text-right tabular-nums">{t.cards.toLocaleString("en-US")}</td>
                      <td className="py-2 text-right font-medium tabular-nums">{t.copies.toLocaleString("en-US")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </StatCard>
          ))}
        </div>
      )}
    </>
  );
}
