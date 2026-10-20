import type { Printing } from "@/bot/src/card-match";
import { CardThumb } from "@/components/card-thumb";
import { cardImage } from "@/components/deck-cards";
import { EmptyState, ErrorState, MemberRankRow, RankList, StatCard } from "@/components/stat-ui";
import { allPages } from "@/lib/decks";
import { guildTimeZone } from "@/lib/guild";
import { createClient } from "@/lib/supabase/server";
import { fits, wishlist, type WishRow } from "@/lib/wishlist";
import Link from "next/link";

/** A row of guild_trade_offers(): copies of one printing and language, and where to meet that member. */
interface Offer {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  card_id: string;
  printing_id: string;
  language: string;
  copies: number;
  place_kind: "event" | "regulars" | "city" | null;
  event_name: string | null;
  starts_at: string | null;
  store_name: string | null;
  store_city: string | null;
}

/**
 * The visitor's wishlist against what the other members of this server have for trade, with a
 * place to meet. Call after memberGuild(): guild_trade_offers() decides who may show.
 */
export async function TradeStats({ guild }: { guild: string }) {
  const supabase = await createClient();
  const me = await supabase.rpc("current_discord_id");
  if (me.error || !me.data) return <ErrorState title="Could not load your trades">Try again in a minute.</ErrorState>;
  const rows = await allPages<WishRow, { message: string }>((from, to) =>
    supabase.rpc("profile_wishlist", { u: me.data as string }).range(from, to),
  );
  if (rows.error) return <ErrorState title="Could not load your trades">Try again in a minute.</ErrorState>;
  const wanted = wishlist(rows.data).filter((w) => w.wanted > 0);
  const ids = [...new Set(wanted.map((w) => w.card_id))];
  const [timeZone, offers, cards, printings] = await Promise.all([
    guildTimeZone(guild),
    allPages<Offer, { message: string }>((from, to) => supabase.rpc("guild_trade_offers", { guild, p_cards: ids }).range(from, to)),
    supabase.from("riftbound_cards").select("id, name, type").in("id", ids),
    supabase.from("riftbound_printings").select("id, card_id, image_url").in("card_id", ids).order("collector_number").order("id"),
  ]);
  if (offers.error || cards.error || printings.error) return <ErrorState title="Could not load your trades">Try again in a minute.</ErrorState>;
  const names = new Map(cards.data.map((c) => [c.id as string, c.name as string]));
  const battlefields = new Set(cards.data.filter((c) => c.type === "Battlefield").map((c) => c.id as string));
  const image = cardImage(printings.data as Printing[]);
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  // Per card, per trader: their copies that fit a printing or language the visitor wants.
  const matches = ids
    .map((card) => {
      const traders = new Map<string, Offer>();
      for (const o of offers.data) {
        if (o.card_id !== card || !wanted.some((w) => w.card_id === card && fits(o, w))) continue;
        const t = traders.get(o.user_id);
        traders.set(o.user_id, t ? { ...t, copies: t.copies + o.copies } : o);
      }
      return { card, want: wanted.filter((w) => w.card_id === card).reduce((n, w) => n + w.wanted, 0), traders: [...traders.values()] };
    })
    .filter((m) => m.traders.length > 0)
    .toSorted((a, b) => (names.get(a.card) ?? "").localeCompare(names.get(b.card) ?? ""));
  return (
    <StatCard title="Trade matches" description="Cards on your wishlist that other members have for trade" wide>
      {wanted.length === 0 ? (
        <EmptyState>
          Nothing on your wishlist yet. Add the cards you want on your{" "}
          <Link href="/wishlist" className="underline underline-offset-4">
            wishlist
          </Link>
          .
        </EmptyState>
      ) : matches.length === 0 ? (
        <EmptyState>Nobody here has a card you want for trade yet. You get a DM from the bot when someone does.</EmptyState>
      ) : (
        matches.map((m) => (
          <div key={m.card} className="flex min-w-0 flex-col gap-2">
            <h3 className="flex items-center justify-between gap-3 text-sm font-medium">
              <Link href={`/cards/${m.card}`} className="flex min-w-0 items-center gap-3 rounded-md underline-offset-4 hover:text-gold hover:underline">
                <span className="w-12 shrink-0">
                  <CardThumb url={image(m.card, null)} name="" width={48} landscape={battlefields.has(m.card)} />
                </span>
                <span className="truncate">{names.get(m.card) ?? m.card}</span>
              </Link>
              <span className="shrink-0 tabular-nums text-muted-foreground">You want {m.want}</span>
            </h3>
            <RankList>
              {m.traders.map((t, i) => (
                <MemberRankRow
                  key={t.user_id}
                  rank={i + 1}
                  name={t.display_name}
                  avatarUrl={t.avatar_url}
                  value={`${t.copies} for trade`}
                  detail={<span className="truncate">{meetAt(t, (at) => when.format(new Date(at)))}</span>}
                  href={`/u/${t.user_id}`}
                />
              ))}
            </RankList>
          </div>
        ))
      )}
    </StatCard>
  );
}

/** Where to meet, as the bot's DM says it: an event, a store, a city. Never an address. */
function meetAt(o: Offer, time: (at: string) => string): string {
  const store = o.store_name && `${o.store_name} (${o.store_city})`;
  if (o.place_kind === "event" && o.starts_at) {
    return `You are both going: ${[time(o.starts_at), o.event_name, store].filter(Boolean).join(" · ")}`;
  }
  if (o.place_kind === "regulars") return `You are both regulars at ${store}`;
  if (o.place_kind === "city") return `Nearest store: ${store}`;
  return "No shared event or store yet: ask in the server";
}
