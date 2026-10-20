import { createDeck } from "@/app/decks/actions";
import { DeckEditor, type Deck } from "@/components/deck-editor";
import { LogInPrompt } from "@/components/server-picker";
import { EmptyState, ErrorState, StatCard } from "@/components/stat-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Card, Printing } from "@/bot/src/card-match";
import { VISIBILITIES, type Entry } from "@/lib/decks";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";

const LOG_IN = "Log in to build Riftbound decks.";
// shortcut: PostgREST caps a response at 1000 rows, as on the Cards page; page it when the real API (#96) lands.
const MAX_CARDS = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The visitor's own decks (RLS also returns others' visible ones, so filtered by owner). */
export async function DeckList() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return <LogInPrompt text={LOG_IN} />;
  const me = await supabase.rpc("current_discord_id");
  if (me.error) return <ErrorState title="Could not load your decks">Try again in a minute.</ErrorState>;
  if (!me.data) return <LogInPrompt text={LOG_IN} />;
  const { data, error } = await supabase
    .from("riftbound_decks")
    .select("id, name, visibility, legend:riftbound_cards!legend_id(name, tags), cards:riftbound_deck_cards(section, quantity)")
    .eq("user_id", me.data)
    .order("updated_at", { ascending: false });
  if (error) return <ErrorState title="Could not load your decks">Try again in a minute.</ErrorState>;
  const decks = data as unknown as {
    id: string;
    name: string;
    visibility: string;
    legend: { name: string; tags: string[] } | null;
    cards: { section: string; quantity: number }[];
  }[];
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
    </>
  );
}

/** One deck: the editor for its owner, read-only for anyone else RLS lets see it; a 404 for the rest. */
export async function DeckDetail({ id }: { id: string }) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return <LogInPrompt text="Log in to see this deck." />;
  // Not a uuid is no deck, rather than a database error.
  if (!UUID.test(id)) notFound();
  const [deck, entries, cards, printings, me] = await Promise.all([
    supabase
      .from("riftbound_decks")
      .select("id, user_id, name, legend_id, champion_id, notes, visibility, language, allow_other_languages")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("riftbound_deck_cards").select("section, card_id, printing_id, quantity").eq("deck_id", id),
    supabase.from("riftbound_cards").select("*").order("name").limit(MAX_CARDS),
    supabase.from("riftbound_printings").select("*").order("collector_number").order("collector_code").limit(MAX_CARDS),
    supabase.rpc("current_discord_id"),
  ]);
  if (deck.error || entries.error || cards.error || printings.error || me.error) {
    return <ErrorState title="Could not load this deck">Try again in a minute.</ErrorState>;
  }
  if (!deck.data) notFound();
  const { user_id, ...rest } = deck.data;
  return (
    <DeckEditor
      deck={rest as Deck}
      entries={entries.data as Entry[]}
      catalogue={{ cards: cards.data as Card[], printings: printings.data as Printing[] }}
      mine={user_id === me.data}
    />
  );
}
