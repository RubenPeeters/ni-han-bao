import { createDeck } from "@/app/decks/actions";
import { DeckEditor, RestoreVersion, type Deck, type VersionListed } from "@/components/deck-editor";
import { DeckLending } from "@/components/deck-lending";
import { WishlistModeQuestion } from "@/components/profile-wishlist";
import { LogInPrompt } from "@/components/server-picker";
import { EmptyState, ErrorState, MemberRankRow, RankList, RankRow, StatCard } from "@/components/stat-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Card, Printing } from "@/bot/src/card-match";
import { deckWanted } from "@/bot/src/lend-copies";
import { languageName } from "@/lib/collection";
import { allPages, deckChanges, missingCards, SECTIONS, VISIBILITIES, type Entry, type OwnedCopy, type Pin } from "@/lib/decks";
import { formatExact } from "@/lib/time";
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
  "id, user_id, name, visibility, not_for_lending, legend_id, language, allow_other_languages, updated_at, legend:riftbound_cards!legend_id(name, tags), cards:riftbound_deck_cards(section, card_id, printing_id, quantity)";
type ListedDeck = {
  id: string;
  user_id: string;
  name: string;
  visibility: string;
  not_for_lending: boolean;
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
  const [mine, opened, owned, asked] = await Promise.all([
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
    supabase.from("profiles").select("wishlist_mode").eq("user_id", me.data).maybeSingle(),
  ]);
  if (mine.error || opened.error || owned.error || asked.error) return <ErrorState title="Could not load your decks">Try again in a minute.</ErrorState>;
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
      {!asked.data?.wishlist_mode && <WishlistModeQuestion />}
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
                        d.not_for_lending && "Not for lending",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
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

/** One deck: the editor for its owner, read-only for anyone else RLS lets see it; a 404 for the rest. */
export async function DeckDetail({ id }: { id: string }) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return <LogInPrompt text="Log in to see this deck." />;
  // Not a uuid is no deck, rather than a database error.
  if (!UUID.test(id)) notFound();
  const [deck, entries, cards, printings, me, owned, versions] = await Promise.all([
    supabase
      .from("riftbound_decks")
      .select("id, user_id, name, legend_id, champion_id, notes, visibility, language, allow_other_languages, wishlist_mode, not_for_lending")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("riftbound_deck_cards").select("section, card_id, printing_id, quantity").eq("deck_id", id),
    supabase.from("riftbound_cards").select("*").order("name").limit(MAX_CARDS),
    supabase.from("riftbound_printings").select("*").order("collector_number").order("collector_code").limit(MAX_CARDS),
    supabase.rpc("current_discord_id"),
    ownedCopies(supabase),
    versionList(supabase, id),
  ]);
  if (deck.error || entries.error || cards.error || printings.error || me.error || owned.error) {
    return <ErrorState title="Could not load this deck">Try again in a minute.</ErrorState>;
  }
  if (!deck.data) notFound();
  // The deck still opens without its history, which says it could not load.
  if (versions.error) console.error("riftbound_deck_versions failed:", versions.error.message);
  const { user_id, not_for_lending, ...rest } = deck.data;
  const mine = user_id === me.data;
  // Into the visitor's Which decks can I build?; the function ignores their own and non-public decks.
  if (!mine && rest.visibility === "public") {
    const { error } = await supabase.rpc("open_riftbound_deck", { p_deck: id });
    if (error) console.error("open_riftbound_deck failed:", error.message);
  }
  const missing = missingCards(rest, entries.data as Entry[], owned.data).rows.filter((r) => r.owned < r.quantity);
  const missingIds = [...new Set(missing.map((r) => r.card_id))];
  const [lenders, members] = await Promise.all([
    missingIds.length ? supabase.rpc("riftbound_card_lenders", { p_cards: missingIds }) : { data: [], error: null },
    // Whom the owner can lend to: their servers' members (RLS), not those hidden with /hide-me.
    mine
      ? allPages((from, to) =>
          supabase.from("members").select("user_id, display_name").eq("hidden", false).neq("user_id", me.data).order("guild_id").order("user_id").range(from, to),
        )
      : { data: [], error: null },
  ]);
  // The deck still opens without them, and each says it could not load.
  if (lenders.error) console.error("riftbound_card_lenders failed:", lenders.error.message);
  if (members.error) console.error("members failed:", members.error.message);
  const names = new Map((cards.data as Card[]).map((c) => [c.id, c.name]));
  const short = new Map<string, number>();
  for (const r of missing) short.set(r.card_id, (short.get(r.card_id) ?? 0) + r.quantity - r.owned);
  const borrowers = [...new Map((members.data ?? []).map((m) => [m.user_id, m])).values()].toSorted((a, b) =>
    a.display_name.localeCompare(b.display_name),
  );
  return (
    <DeckEditor
      deck={rest as Deck}
      entries={entries.data as Entry[]}
      catalogue={{ cards: cards.data as Card[], printings: printings.data as Printing[] }}
      owned={owned.data}
      mine={mine}
      versions={versions.data}
      lending={
        <>
          <WhoHasMissing
            missing={[...short].map(([card_id, n]) => ({ card_id, name: names.get(card_id) ?? card_id, missing: n }))}
            lenders={lenders.error ? null : (lenders.data as CardLender[])}
          />
          {mine && (
            <DeckLending
              deckId={id}
              notForLending={not_for_lending}
              wanted={deckWanted({ cards: cards.data as Card[] }, { legend_id: rest.legend_id, entries: entries.data as Entry[] })}
              members={members.error ? [] : borrowers}
            />
          )}
        </>
      }
    />
  );
}

/** A row of riftbound_card_lenders(): a member of one of the visitor's servers with copies of a card to lend. */
interface CardLender {
  card_id: string;
  guild_id: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  copies: number;
  languages: string[] | null;
}

/**
 * Who has my missing cards?: for each card the visitor is short of, who in their servers has
 * copies to lend. riftbound_card_lenders() leaves out copies not available, and whoever may not show.
 */
function WhoHasMissing({ missing, lenders }: { missing: { card_id: string; name: string; missing: number }[]; lenders: CardLender[] | null }) {
  if (missing.length === 0) return null;
  return (
    <StatCard title="Who has my missing cards?" description="Members of your servers with copies to lend">
      {lenders === null ? (
        <ErrorState title="Could not load who lends them">Try again in a minute.</ErrorState>
      ) : (
        <ul className="flex flex-col divide-y">
          {missing.map((m) => {
            // One row per member, though they may share several servers with the visitor.
            const who = [...new Map(lenders.filter((l) => l.card_id === m.card_id).map((l) => [l.user_id, l])).values()];
            return (
              <li key={m.card_id} className="flex flex-col gap-2 py-3 text-sm first:pt-0 last:pb-0">
                <span className="flex min-w-0 items-baseline justify-between gap-3">
                  <Link href={`/cards/${m.card_id}`} className="truncate font-medium hover:underline">
                    {m.name}
                  </Link>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{m.missing} missing</span>
                </span>
                {who.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nobody in your servers lends it yet.</p>
                ) : (
                  <RankList>
                    {who.map((l, i) => (
                      <MemberRankRow
                        key={l.user_id}
                        rank={i + 1}
                        name={l.display_name}
                        avatarUrl={l.avatar_url}
                        value={`${l.copies} to lend`}
                        detail={(l.languages ?? []).map(languageName).join(", ")}
                        href={`/u/${l.user_id}`}
                      />
                    ))}
                  </RankList>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </StatCard>
  );
}

/** A deck's versions, newest first; RLS returns them only if the deck is visible. */
const versionList = (supabase: Awaited<ReturnType<typeof createClient>>, id: string) =>
  allPages<VersionListed, { message: string }>((from, to) =>
    supabase.from("riftbound_deck_versions").select("version, saved_at").eq("deck_id", id).order("version", { ascending: false }).range(from, to),
  );

const VERSION = "version, saved_at, name, legend_id, champion_id, notes, language, allow_other_languages, entries";
type SavedVersion = Omit<Deck, "id" | "visibility" | "wishlist_mode"> & VersionListed & { entries: Entry[] };

const pinText = (pins: Pin[], codes: Map<string, string>) =>
  pins.map((p) => `${p.quantity} ${codes.get(p.printing_id) ?? p.printing_id}`).join(", ") || "none";

/**
 * One saved version, read-only, as the deck page shows a deck, with what changed since another
 * version (the one before, unless `from` says) and, for the owner, Restore. A 404 for whoever
 * cannot see the deck now: old versions follow its current visibility.
 */
export async function DeckVersionDetail({ id, version, from }: { id: string; version: string; from: string | undefined }) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return <LogInPrompt text="Log in to see this deck." />;
  const n = Number(version);
  if (!UUID.test(id) || !Number.isInteger(n) || n < 1) notFound();
  const [deck, versions, cards, printings, me, owned] = await Promise.all([
    supabase.from("riftbound_decks").select("user_id, visibility, wishlist_mode").eq("id", id).maybeSingle(),
    versionList(supabase, id),
    supabase.from("riftbound_cards").select("*").order("name").limit(MAX_CARDS),
    supabase.from("riftbound_printings").select("*").order("collector_number").order("collector_code").limit(MAX_CARDS),
    supabase.rpc("current_discord_id"),
    ownedCopies(supabase),
  ]);
  if (deck.error || versions.error || cards.error || printings.error || me.error || owned.error) {
    return <ErrorState title="Could not load this version">Try again in a minute.</ErrorState>;
  }
  if (!deck.data || !versions.data.some((v) => v.version === n)) notFound();
  const fromRequested = Number(from);
  const before = versions.data.some((v) => v.version === fromRequested && v.version !== n) ? fromRequested : n - 1;
  const saved = await supabase
    .from("riftbound_deck_versions")
    .select(VERSION)
    .eq("deck_id", id)
    .in("version", [n, before]);
  if (saved.error) return <ErrorState title="Could not load this version">Try again in a minute.</ErrorState>;
  const rows = saved.data as unknown as SavedVersion[];
  const shown = rows.find((v) => v.version === n)!;
  const compared = rows.find((v) => v.version === before);
  const { saved_at, entries, ...settings } = shown;
  const asDeck: Deck = { ...settings, id, visibility: deck.data.visibility, wishlist_mode: deck.data.wishlist_mode };
  const names = new Map((cards.data as Card[]).map((c) => [c.id, c.name]));
  const codes = new Map((printings.data as Printing[]).map((p) => [p.id, p.collector_code]));
  const changes = compared ? deckChanges(compared, shown) : [];
  const sectionLabel = (s: string) => (s === "legend" ? "Legend" : s === "champion" ? "Chosen Champion" : SECTIONS.find((x) => x.value === s)?.label);
  const latest = versions.data[0].version;
  return (
    <DeckEditor
      deck={asDeck}
      entries={entries}
      catalogue={{ cards: cards.data as Card[], printings: printings.data as Printing[] }}
      owned={owned.data}
      mine={false}
    >
      <StatCard
        title={`Version ${n} of ${latest}`}
        description={`Saved ${formatExact(new Date(saved_at))}${n === latest ? ", the deck as it is now" : ""}`}
        aside={
          <Link href={`/decks/${id}`} className="rounded-md text-sm text-muted-foreground hover:text-foreground">
            Current deck
          </Link>
        }
      >
        {versions.data.length > 1 && (
          // A plain GET form: comparing works without JavaScript.
          <form className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium">
              Changes since
              <select
                name="from"
                defaultValue={compared ? String(before) : ""}
                className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {!compared && <option value="">Pick a version</option>}
                {versions.data
                  .filter((v) => v.version !== n)
                  .map((v) => (
                    <option key={v.version} value={v.version}>
                      Version {v.version} · {formatExact(new Date(v.saved_at))}
                    </option>
                  ))}
              </select>
            </label>
            <Button type="submit" variant="secondary" size="lg" className="h-11">
              Compare
            </Button>
          </form>
        )}
        {!compared ? (
          <EmptyState>The first version: nothing before it to compare.</EmptyState>
        ) : changes.length === 0 ? (
          <EmptyState>No card changed since version {before}.</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y">
            {changes.map((c) => (
              <li key={`${c.section}|${c.card_id}`} className="flex items-center gap-3 py-2 text-sm first:pt-0 last:pb-0">
                <span
                  className={`w-10 shrink-0 text-right font-semibold tabular-nums ${c.delta ? "" : "text-muted-foreground"}`}
                >
                  {c.delta > 0 ? `+${c.delta}` : c.delta < 0 ? `−${-c.delta}` : "±0"}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{names.get(c.card_id) ?? c.card_id}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {[sectionLabel(c.section), c.pins && `pinned: ${pinText(c.pins.from, codes)} → ${pinText(c.pins.to, codes)}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {deck.data.user_id === me.data && n !== latest && <RestoreVersion deck={asDeck} entries={entries} version={n} />}
      </StatCard>
    </DeckEditor>
  );
}
