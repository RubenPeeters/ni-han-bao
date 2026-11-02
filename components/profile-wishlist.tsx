import { setWishlistMode } from "@/app/u/[userId]/actions";
import { byPrinting, SET_NAMES, type Card, type Printing } from "@/bot/src/card-match";
import { riftboundIcons } from "@/components/card-library";
import { CardThumb } from "@/components/card-thumb";
import { cardImage, type CardImage } from "@/components/deck-cards";
import { ProfileHeader, SettingsLink, type Profile } from "@/components/profile-stats";
import { PlaysetGoal } from "@/components/playset-goal";
import { DomainIcon, RarityIcon, TypeIcon, type RiftboundIcon } from "@/components/riftbound-icons";
import { EmptyState, ErrorState, StatCard } from "@/components/stat-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WishlistEditor } from "@/components/wishlist-editor";
import { isBasicPrinting, languageName } from "@/lib/collection";
import { allPages } from "@/lib/decks";
import { createClient } from "@/lib/supabase/server";
import { WISHLIST_MODES, wishlist, type Wanted, type WishRow } from "@/lib/wishlist";
import Link from "next/link";
import { notFound } from "next/navigation";

// The columns of a Printing: not the printing's own text, which the editors do not show.
const PRINTING = "id, card_id, set_code, collector_code, collector_number, rarity, illustrator, image_url";

/**
 * A profile's Wishlist tab: what its owner still wants, worked out from their decks, their own
 * entries, their playset goal and their collection. profile() and profile_wishlist() check can_see_profile().
 */
export async function ProfileWishlist({ user, own }: { user: string; own?: boolean }) {
  const supabase = await createClient();
  const [profile, rows, cards, printings, icons] = await Promise.all([
    supabase.rpc("profile", { u: user }).maybeSingle<Profile>(),
    allPages<WishRow, { message: string }>((from, to) => supabase.rpc("profile_wishlist", { u: user }).range(from, to)),
    allPages((from, to) => supabase.from("riftbound_cards").select("*").order("name").order("id").range(from, to)),
    allPages((from, to) => supabase.from("riftbound_printings").select(PRINTING).order("collector_number").order("id").range(from, to)),
    riftboundIcons(supabase),
  ]);
  if (profile.error || rows.error || cards.error || printings.error) {
    return <ErrorState title="Could not load this wishlist">Try again in a minute.</ErrorState>;
  }
  // Private, hidden, forgotten or unknown: the same 404 as the other tabs.
  if (!profile.data) notFound();
  const { mine } = profile.data;
  const goal = mine
    ? await Promise.all([
        supabase.from("profiles").select("playset_all_sets").eq("user_id", user).maybeSingle(),
        supabase.from("riftbound_playset_goals").select("set_code"),
      ])
    : null;
  if (goal?.some((r) => r.error)) return <ErrorState title="Could not load this wishlist">Try again in a minute.</ErrorState>;
  const byId = new Map((cards.data as Card[]).map((c) => [c.id, c]));
  const names = new Map((cards.data as Card[]).map((c) => [c.id, c.name]));
  const pins = new Map((printings.data as Printing[]).map((p) => [p.id, p]));
  const image = cardImage(printings.data as Printing[]);
  const byName = (a: Wanted, b: Wanted) => (names.get(a.card_id) ?? "").localeCompare(names.get(b.card_id) ?? "");
  const all = wishlist(rows.data);
  const priority = all.filter((r) => r.wanted > r.playset).toSorted(byName);
  const playset = all.filter((r) => r.playset > 0).toSorted(byName);
  const priorityTotal = priority.reduce((n, r) => n + r.wanted - r.playset, 0);
  const playsetTotal = playset.reduce((n, r) => n + r.playset, 0);
  // A set's normal numbers, in release order: what a playset of it is, and where a goal card is listed.
  // shortcut: a reprint is listed under its first set even when only a later one is chosen; pass the set in profile_wishlist() if that confuses.
  const basic = (printings.data as Printing[]).filter((p) => isBasicPrinting(p.collector_code, p.collector_number)).toSorted(byPrinting);
  const firstSet = new Map<string, string>();
  for (const p of basic) if (!firstSet.has(p.card_id)) firstSet.set(p.card_id, p.set_code);
  const perSet = Map.groupBy(basic, (p) => p.set_code);
  const sets = [...perSet].map(([code, ps]) => ({ code, name: SET_NAMES[code] ?? code, cards: new Set(ps.map((p) => p.card_id)).size }));
  const goalBySet = Map.groupBy(playset, (r) => firstSet.get(r.card_id) ?? "");
  const row = (r: Wanted, n: number) => (
    <WantedRow key={`${r.card_id}|${r.printing_id}|${r.language}`} r={r} n={n} card={byId.get(r.card_id)} pins={pins} image={image} icons={icons} />
  );
  return (
    <>
      {!own && (
        <ProfileHeader
          user={user}
          profile={profile.data}
          subtitle={mine ? "The Riftbound cards you still want." : "The Riftbound cards they still want."}
          manage="/wishlist"
        />
      )}
      {mine && <SettingsLink href="/settings#riftbound">How your new decks count on your wishlist is a setting.</SettingsLink>}
      <StatCard
        title={mine ? "For my decks and cards I added" : "For their decks and cards they added"}
        description={`${cards_(priorityTotal)} still to get`}
      >
        {priority.length === 0 ? (
          <EmptyState>
            {mine ? (
              <>
                Nothing wanted. Add cards below, or count a deck&apos;s cards with its Wishlist setting in the{" "}
                <Link href="/decks" className="text-crystal underline underline-offset-4 hover:text-crystal/80">
                  deck editor
                </Link>
                .
              </>
            ) : (
              "Nothing on their wishlist."
            )}
          </EmptyState>
        ) : (
          <ul className="flex flex-col divide-y">{priority.map((r) => row(r, r.wanted - r.playset))}</ul>
        )}
      </StatCard>
      {playset.length > 0 && (
        <StatCard title="Playset goal" description={`${cards_(playsetTotal)} still to get, after the decks`}>
          <div className="flex flex-col divide-y">
            {sets
              .filter((s) => goalBySet.has(s.code))
              .map((s) => {
                const wanted = goalBySet.get(s.code)!;
                return (
                  <details key={s.code} className="min-w-0">
                    <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-md text-sm font-medium hover:text-muted-foreground">
                      <span>{s.name}</span>
                      <span className="tabular-nums text-muted-foreground">{cards_(wanted.reduce((n, r) => n + r.playset, 0))}</span>
                    </summary>
                    <ul className="flex flex-col divide-y pb-2">{wanted.map((r) => row(r, r.playset))}</ul>
                  </details>
                );
              })}
          </div>
        </StatCard>
      )}
      {mine && (
        <WishlistEditor
          wishes={rows.data.flatMap((r) => (r.manual ? [{ card_id: r.card_id, printing_id: r.printing_id, quantity: r.manual }] : []))}
          catalogue={{ cards: cards.data as Card[], printings: printings.data as Printing[] }}
        />
      )}
      {goal && (
        <PlaysetGoal sets={sets} all={goal[0].data?.playset_all_sets ?? false} chosen={(goal[1].data ?? []).map((g) => g.set_code as string)} />
      )}
      <p className="text-xs text-muted-foreground">
        Worked out each time from {mine ? "your" : "their"} decks, entries, playset goal and collection. Whoever may see{" "}
        {mine ? "your" : "this"} profile sees it.
      </p>
    </>
  );
}

const cards_ = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "card" : "cards"}`;

/** One wanted card, pin and language: `n` of it in this section, and the split when it is in both. */
function WantedRow({
  r,
  n,
  card,
  pins,
  image,
  icons,
}: {
  r: Wanted;
  n: number;
  card: Card | undefined;
  pins: Map<string, Printing>;
  image: CardImage;
  icons: RiftboundIcon[];
}) {
  const pin = r.printing_id ? pins.get(r.printing_id) : undefined;
  const split = r.playset > 0 && r.wanted > r.playset && `${r.wanted - r.playset} for decks, ${r.playset} for the playset`;
  return (
    <li className="flex items-center gap-3 py-2 text-sm first:pt-0 last:pb-0">
      <Link href={`/cards/${r.card_id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-md hover:underline">
        <span className="w-12 shrink-0">
          <CardThumb url={image(r.card_id, r.printing_id)} name="" width={48} landscape={card?.type === "Battlefield"} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate font-medium">{card?.name ?? r.card_id}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {card?.type && <TypeIcon icons={icons} type={card.type} />}
            {card?.domains.map((d) => <DomainIcon key={d} icons={icons} domain={d} />)}
            {r.printing_id && (
              <span className="inline-flex items-center gap-1">
                {pin?.rarity && <RarityIcon icons={icons} rarity={pin.rarity} />}
                Only {pin?.collector_code ?? r.printing_id}
              </span>
            )}
            {r.language && <Badge variant="outline">{languageName(r.language)} only</Badge>}
            {(r.decks > 0 || !!r.manual || split) && (
              <span>{[r.decks > 0 && `decks need ${r.decks}`, r.manual && `wanted ${r.manual} in all`, split].filter(Boolean).join(" · ")}</span>
            )}
          </span>
        </span>
      </Link>
      <span className="shrink-0 font-medium tabular-nums">{n} wanted</span>
    </li>
  );
}

/** Asked once, on the Decks page: how new decks count on the wishlist. Changed later on /settings. */
export function WishlistModeQuestion() {
  return (
    <form action={setWishlistMode} className="card flex flex-col gap-4">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-medium">How should your new decks count on your wishlist?</legend>
        {WISHLIST_MODES.map((m) => (
          <label key={m.value} className="flex items-start gap-3 text-sm">
            <input type="radio" name="mode" value={m.value} defaultChecked={m.value === "shared"} className="mt-0.5 size-4 accent-primary" />
            <span className="flex flex-col">
              <span className="font-medium">{m.label}</span>
              <span className="text-muted-foreground">{m.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-muted-foreground">Decks you have now stay as they are: change one in its editor.</p>
      <Button type="submit" size="sm" className="self-start">
        Save
      </Button>
    </form>
  );
}
