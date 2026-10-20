import { createDeck } from "@/app/decks/actions";
import { DeckEditor, type Deck } from "@/components/deck-editor";
import { LogInPrompt } from "@/components/server-picker";
import { EmptyState, ErrorState, RankList, RankRow, StatCard } from "@/components/stat-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Card, Printing } from "@/bot/src/card-match";
import { missingCards, type OwnedCopy } from "@/bot/src/deck-match";
import { allPages, VISIBILITIES, type Entry } from "@/lib/decks";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";

const LOG_IN = "Log in to build Riftbound decks.";
// shortcut: PostgREST caps a response at 1000 rows, as on the Cards page; page it when the real API (#96) lands.
const MAX_CARDS = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The visitor's copies (RLS returns their own rows only). */
async function ownedCopies(supabase: Awaited<ReturnType<typeof createClient>>) {
  const res = await allPages((from, to) =>
    supabase
      .from("riftbound_collection")
      .select("printing_id, language, quantity, printing:riftbound_printings(card_id)")
      .order("printing_id")
      .order("finish")
      .order("condition")
      .order("language")
      .range(from, to),
  );
  if (res.error) return res;
  const rows = res.data as unknown as (Omit<OwnedCopy, "card_id"> & { printing: { card_id: string } })[];
  return { data: rows.map(({ printing, ...c }): OwnedCopy => ({ ...c, card_id: printing.card_id })), error: null };
}

const DECK =
  "id, user_id, name, visibility, legend_id, language, allow_other_languages, updated_at, legend:riftbound_cards!legend_id(name, tags), cards:riftbound_deck_cards(section, card_id, printing_id, quantity)";
type ListedDeck = {
  id: string;
  user_id: string;
  name: string;
  visibility: string;
  legend_id: string | null;
  language: string;
  allow_other_languages: boolean;
  updated_at: string;
  legend: { name: string; tags: string[] } | null;
  cards: Entry[];
};

/**
 * The visitor's own decks, and every deck they could build against their collection: their
 * own, those shared with their servers (RLS keeps the servers they are in) and public ones
 * they opened.
 */
export async function DeckList() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return <LogInPrompt text={LOG_IN} />;
  const me = await supabase.rpc("current_discord_id");
  if (me.error) return <ErrorState title="Could not load your decks">Try again in a minute.</ErrorState>;
  if (!me.data) return <LogInPrompt text={LOG_IN} />;
  const [mine, opened, owned] = await Promise.all([
    allPages((from, to) =>
      supabase
        .from("riftbound_decks")
        .select(DECK)
        .or(`user_id.eq.${me.data},visibility.eq.servers`)
        .order("id")
        .range(from, to),
    ),
    // Through the opens, so no id list goes in the URL; RLS drops a deck no longer public.
    allPages((from, to) => supabase.from("riftbound_deck_opens").select(`deck:riftbound_decks(${DECK})`).order("deck_id").range(from, to)),
    ownedCopies(supabase),
  ]);
  if (mine.error || opened.error || owned.error) return <ErrorState title="Could not load your decks">Try again in a minute.</ErrorState>;
  const byId = new Map<string, ListedDeck>();
  for (const d of [...(mine.data as unknown as ListedDeck[]), ...(opened.data as unknown as { deck: ListedDeck | null }[]).map((o) => o.deck)]) {
    if (d) byId.set(d.id, d);
  }
  const all = [...byId.values()]
    .toSorted((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .map((d) => ({ ...d, missing: missingCards(d, d.cards, owned.data).missing }));
  const decks = all.filter((d) => d.user_id === me.data);
  const buildable = all.toSorted((a, b) => a.missing - b.missing || a.name.localeCompare(b.name));
  return (
    <>
      <form action={createDeck} className="card flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium">
          New deck
          <Input name="name" placeholder="Deck name" maxLength={100} autoComplete="off" className="h-11 text-base md:text-base" />
        </label>
        <Button type="submit" size="lg" className="h-11">
          Make deck
        </Button>
      </form>
      <StatCard title="Your decks" description="Private unless you share one in its editor">
        {decks.length === 0 ? (
          <EmptyState>No decks yet. Make one above, then search or paste its cards.</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y">
            {decks.map((d) => {
              const main = d.cards.filter((c) => c.section === "main").reduce((n, c) => n + c.quantity, 0);
              return (
                <li key={d.id}>
                  <Link
                    href={`/decks/${d.id}`}
                    className="flex min-w-0 flex-col gap-1 rounded-md py-3 hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="truncate font-medium">{d.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {[
                        d.legend ? `${d.legend.tags.join(", ")}, ${d.legend.name}` : "No Legend yet",
                        `${main} main deck cards`,
                        VISIBILITIES.find((v) => v.value === d.visibility)?.label.split(":")[0],
                      ].join(" · ")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </StatCard>
      <StatCard title="Which decks can I build?" description="Yours, your servers' and public ones you opened, by the fewest cards you are missing">
        {buildable.length === 0 ? (
          <EmptyState>No decks yet. Yours, your servers&apos; and public ones you open appear here.</EmptyState>
        ) : (
          <RankList>
            {buildable.map((d, i) => (
              <RankRow key={d.id} rank={i + 1} value={d.missing ? `${d.missing} missing` : "Complete"}>
                <Link
                  href={`/decks/${d.id}`}
                  className="flex min-w-0 flex-1 flex-col rounded-md hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="truncate font-medium">{d.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {[d.legend ? `${d.legend.tags.join(", ")}, ${d.legend.name}` : "No Legend yet", d.user_id === me.data ? "Yours" : "Shared"].join(" · ")}
                  </span>
                </Link>
              </RankRow>
            ))}
          </RankList>
        )}
      </StatCard>
    </>
  );
}

/** A logged-out visitor's deck page: a public deck read-only, without its owner; any other asks to log in. */
async function PublicDeck({ id, supabase }: { id: string; supabase: Awaited<ReturnType<typeof createClient>> }) {
  const { data, error } = await supabase.rpc("public_deck", { p_deck: id });
  if (error) return <ErrorState title="Could not load this deck">Try again in a minute.</ErrorState>;
  if (!data) return <LogInPrompt text="Log in to see this deck." />;
  const { deck, entries, cards, printings } = data as { deck: Deck; entries: Entry[]; cards: Card[]; printings: Printing[] };
  return <DeckEditor deck={deck} entries={entries} catalogue={{ cards, printings }} owned={null} mine={false} />;
}

/** One deck: the editor for its owner, read-only for anyone else RLS lets see it; a 404 for the rest. */
export async function DeckDetail({ id }: { id: string }) {
  const supabase = await createClient();
  // Not a uuid is no deck, rather than a database error.
  if (!UUID.test(id)) notFound();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return <PublicDeck id={id} supabase={supabase} />;
  const [deck, entries, cards, printings, me, owned] = await Promise.all([
    supabase
      .from("riftbound_decks")
      .select("id, user_id, name, legend_id, champion_id, notes, visibility, language, allow_other_languages")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("riftbound_deck_cards").select("section, card_id, printing_id, quantity").eq("deck_id", id),
    supabase.from("riftbound_cards").select("*").order("name").limit(MAX_CARDS),
    supabase.from("riftbound_printings").select("*").order("collector_number").order("collector_code").limit(MAX_CARDS),
    supabase.rpc("current_discord_id"),
    ownedCopies(supabase),
  ]);
  if (deck.error || entries.error || cards.error || printings.error || me.error || owned.error) {
    return <ErrorState title="Could not load this deck">Try again in a minute.</ErrorState>;
  }
  if (!deck.data) notFound();
  const { user_id, ...rest } = deck.data;
  // Into the visitor's Which decks can I build?; the function ignores their own and non-public decks.
  if (user_id !== me.data && rest.visibility === "public") {
    const { error } = await supabase.rpc("open_riftbound_deck", { p_deck: id });
    if (error) console.error("open_riftbound_deck failed:", error.message);
  }
  return (
    <DeckEditor
      deck={rest as Deck}
      entries={entries.data as Entry[]}
      catalogue={{ cards: cards.data as Card[], printings: printings.data as Printing[] }}
      owned={owned.data}
      mine={user_id === me.data}
    />
  );
}
