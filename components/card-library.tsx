import { byPrinting } from "@/bot/src/card-match";
import { AddToDeck, type MyDeck } from "@/components/add-to-deck";
import { CardGrid, type LibraryCard } from "@/components/card-grid";
import { CardThumb } from "@/components/card-thumb";
import { DomainIcon, RarityIcon, RulesText, SupertypeIcon, TypeIcon, type RiftboundIcon } from "@/components/riftbound-icons";
import { LogInPrompt } from "@/components/server-picker";
import { EmptyState, ErrorState, MemberRankRow, RankList, StatCard } from "@/components/stat-ui";
import { languageName, type Language, type OwnedRow } from "@/lib/collection";
import { allPages } from "@/lib/decks";
import { createClient } from "@/lib/supabase/server";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

interface Printing {
  id: string;
  set_code: string;
  collector_code: string;
  collector_number: number;
  rarity: string | null;
  illustrator: string | null;
  image_url: string | null;
}

interface Card {
  id: string;
  name: string;
  type: string;
  supertypes: string[];
  domains: string[];
  energy: number | null;
  might: number | null;
  tags: string[];
  rules_text: string | null;
  printings: Printing[];
}

// PostgREST's cap on the rows of one response.
const PAGE = 1000;
const LOG_IN = "Log in to look through the Riftbound cards.";

/**
 * The visitor's whole collection (RLS returns their own rows only), paged past PostgREST's
 * 1000-row cap: a row missing here would look unowned and the next tap would overwrite it.
 */
async function ownedRows(supabase: Awaited<ReturnType<typeof createClient>>) {
  const rows: OwnedRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("riftbound_collection")
      .select("printing_id, finish, condition, language, quantity, for_trade, lendable")
      .order("printing_id")
      .order("finish")
      .order("condition")
      .order("language")
      .range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    rows.push(...(data as OwnedRow[]));
    if (data.length < PAGE) return { data: rows, error: null };
  }
}

/** Riot's icons. Decoration: a failed read, or none yet, shows names instead. */
export async function riftboundIcons(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.from("riftbound_icons").select("facet, value, label, icon_url").returns<RiftboundIcon[]>();
  return data ?? [];
}

/** The visitor's own decks, for Add to deck (RLS also returns others' visible ones). */
async function myDecks(supabase: Awaited<ReturnType<typeof createClient>>, me: string) {
  return supabase.from("riftbound_decks").select("id, name").eq("user_id", me).order("name").returns<MyDeck[]>();
}

/**
 * The global Riftbound catalogue: not per server, so no guild filter; RLS lets anyone logged in read it.
 * `owned`: only the cards the visitor owns, for /collection.
 */
export async function CardLibrary({ owned: ownedOnly = false }: { owned?: boolean }) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return <LogInPrompt text={LOG_IN} />;
  const [{ data, error }, me, owned, icons] = await Promise.all([
    allPages((from, to) => supabase.from("riftbound_cards").select("*, printings:riftbound_printings(*)").order("id").range(from, to)),
    supabase.rpc("current_discord_id"),
    ownedRows(supabase),
    riftboundIcons(supabase),
  ]);
  if (error || me.error || owned.error) return <ErrorState title="Could not load the cards">Try again in a minute.</ErrorState>;
  // Logged in, but not with Discord: no collection to edit.
  if (!me.data) return <LogInPrompt text={LOG_IN} />;
  const [lending, decks] = await Promise.all([
    supabase.from("profiles").select("lends_cards, lend_all, card_language").eq("user_id", me.data).maybeSingle(),
    myDecks(supabase, me.data),
  ]);
  if (lending.error) return <ErrorState title="Could not load the cards">Try again in a minute.</ErrorState>;
  const cards = (data as Card[]).map((c) => ({ ...c, printings: c.printings.toSorted(byPrinting) }));
  // Set and collector order, as in a binder; a card without printings goes last.
  const first = (a: Card, b: Card) => (a.printings[0] && b.printings[0] ? byPrinting(a.printings[0], b.printings[0]) : b.printings.length - a.printings.length);
  const have = new Set(owned.data.flatMap((r) => (r.quantity > 0 ? [r.printing_id] : [])));
  const library: LibraryCard[] = cards
    .filter((c) => !ownedOnly || c.printings.some((p) => have.has(p.id)))
    .toSorted((a, b) => first(a, b) || a.name.localeCompare(b.name))
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      domains: c.domains,
      energy: c.energy,
      tags: c.tags,
      sets: [...new Set(c.printings.map((p) => p.set_code))],
      printings: c.printings.map(({ id, set_code, collector_code, collector_number, rarity, image_url }) => ({ id, set_code, collector_code, collector_number, rarity, image_url })),
      image_url: c.printings.find((p) => p.image_url)?.image_url ?? null,
    }));
  if (ownedOnly && library.length === 0) {
    return (
      <EmptyState>
        No cards yet. Add them on the <Link href="/cards" className="text-crystal underline underline-offset-4 hover:text-crystal/80">Cards</Link> page with Edit
        my collection, or with /collection add in Discord.
      </EmptyState>
    );
  }
  return (
    <CardGrid
      // A CSV import changes the rows under the steppers: remount, or the next tap saves a stale count over it.
      key={`${owned.data.length}:${owned.data.reduce((sum, r) => sum + r.quantity, 0)}`}
      cards={library}
      icons={icons}
      mine={{
        userId: me.data as string,
        owned: owned.data,
        lends: lending.data?.lends_cards ?? false,
        lendAll: lending.data?.lend_all ?? false,
        language: (lending.data?.card_language ?? "en") as Language,
        // Add to deck is extra: without the decks the grid still edits the collection.
        decks: decks.data ?? [],
      }}
    />
  );
}

/** One card with every printing of it. */
export async function CardDetail({ id }: { id: string }) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return <LogInPrompt text={LOG_IN} />;
  const [{ data, error }, lenders, me, icons] = await Promise.all([
    supabase.from("riftbound_cards").select("*, printings:riftbound_printings(*)").eq("id", id).maybeSingle<Card>(),
    supabase.rpc("card_lenders", { p_card: id }),
    supabase.rpc("current_discord_id"),
    riftboundIcons(supabase),
  ]);
  // Like Who has it?, a failed lookup drops Add to deck, not the card.
  const decks = me.data ? await myDecks(supabase, me.data as string) : null;
  if (error) return <ErrorState title="Could not load this card">Try again in a minute.</ErrorState>;
  if (!data) notFound();
  const printings = data.printings.toSorted(byPrinting);
  const dash = (n: number | null) => (n === null ? "-" : String(n));
  const rarities = [...new Set(printings.flatMap((p) => (p.rarity ? [p.rarity] : [])))];
  const listed = (items: ReactNode[]) =>
    items.length ? <span className="flex flex-wrap items-center gap-x-3 gap-y-1">{items}</span> : "-";
  const stats: [string, ReactNode][] = [
    [
      "Type",
      listed([
        ...data.supertypes.map((s) => <SupertypeIcon key={s} icons={icons} supertype={s} withText />),
        ...(data.type ? [<TypeIcon key="type" icons={icons} type={data.type} withText />] : []),
      ]),
    ],
    ["Cost", dash(data.energy)],
    ["Might", dash(data.might)],
    ["Domains", listed(data.domains.map((d) => <DomainIcon key={d} icons={icons} domain={d} withText />))],
    ["Rarity", listed(rarities.map((r) => <RarityIcon key={r} icons={icons} rarity={r} withText />))],
    ["Tags", data.tags.join(", ") || "-"],
  ];
  const landscape = data.type === "Battlefield";
  return (
    <>
      <Link
        href="/cards"
        className="flex w-fit items-center gap-1 rounded-md text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All cards
      </Link>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <div className="mx-auto w-full max-w-xs shrink-0 sm:mx-0 sm:w-64">
          <CardThumb url={printings.find((p) => p.image_url)?.image_url ?? null} name={data.name} landscape={landscape} eager />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="break-words text-4xl font-semibold">{data.name}</h1>
          </div>
          {data.rules_text && <RulesText html={data.rules_text} icons={icons} className="text-muted-foreground" />}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {stats.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
          {decks && !decks.error && <AddToDeck card={{ id: data.id, name: data.name }} decks={decks.data} />}
        </div>
      </div>
      <StatCard
        title="Printings"
        description={`${printings.length.toLocaleString("en-US")} ${printings.length === 1 ? "printing" : "printings"}`}
      >
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {printings.map((p) => (
            <li key={p.id} className="flex min-w-0 flex-col gap-2">
              <CardThumb url={p.image_url} name={data.name} landscape={landscape} />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                  {p.rarity && <RarityIcon icons={icons} rarity={p.rarity} />}
                  <span className="truncate">{p.collector_code}</span>
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {[p.set_code, p.rarity, p.illustrator].filter(Boolean).join(" · ")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </StatCard>
      {/* Decoration of the card page: a failed lookup drops the section, not the card. */}
      {!lenders.error && <WhoHasIt lenders={lenders.data as Lender[]} />}
    </>
  );
}

interface Lender {
  guild_id: string;
  guild_name: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  copies: number;
  languages: string[];
}

/** Per server the visitor is in, who has copies to lend; card_lenders() decides who may show. */
function WhoHasIt({ lenders }: { lenders: Lender[] }) {
  const guilds = [...new Map(lenders.map((l) => [l.guild_id, l.guild_name])).entries()];
  return (
    <StatCard title="Who has it?" description="Members of your servers with copies to lend">
      {guilds.length === 0 ? (
        <EmptyState>Nobody in your servers lends this card yet.</EmptyState>
      ) : (
        guilds.map(([guildId, name]) => (
          <div key={guildId} className="flex min-w-0 flex-col gap-2">
            <h3 className="truncate text-sm font-medium">{name}</h3>
            <RankList>
              {lenders
                .filter((l) => l.guild_id === guildId)
                .map((l, i) => (
                  <MemberRankRow
                    key={l.user_id}
                    rank={i + 1}
                    name={l.display_name}
                    avatarUrl={l.avatar_url}
                    value={`${l.copies} to lend`}
                    detail={l.languages.map(languageName).join(", ")}
                    href={`/u/${l.user_id}`}
                  />
                ))}
            </RankList>
          </div>
        ))
      )}
    </StatCard>
  );
}
