import { CardGrid, CardImage, type LibraryCard } from "@/components/card-grid";
import { CopiesEditor } from "@/components/card-copies";
import type { Collection } from "@/components/collection-sync";
import { LogInPrompt } from "@/components/server-picker";
import { EmptyState, ErrorState, MemberRankRow, RankList, StatCard } from "@/components/stat-ui";
import { Badge } from "@/components/ui/badge";
import type { Copy } from "@/lib/collection";
import { createClient } from "@/lib/supabase/server";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

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
  placeholder: boolean;
  printings: Printing[];
}

// shortcut: PostgREST caps a response at 1000 rows, so a bigger catalogue is cut off; page it when the real API (#96) lands.
const MAX_CARDS = 1000;
const PAGE = 1000;
const byNumber = (a: Printing, b: Printing) =>
  a.collector_number - b.collector_number || a.collector_code.localeCompare(b.collector_code);
const LOG_IN = "Log in to look through the Riftbound cards.";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * The visitor's own copies and lending setting, for the editors; null when they are not
 * logged in with Discord (nothing to save under) or it cannot be read in full: a row missing
 * here would look unowned, and a tap would overwrite it.
 */
async function myCollection(supabase: Client): Promise<Collection | null> {
  const me = await supabase.rpc("current_discord_id");
  if (me.error || !me.data) return null;
  const lending = await supabase.from("riftbound_lending").select("lends, lend_default").maybeSingle();
  if (lending.error) return null;
  const copies: Copy[] = [];
  // PostgREST returns at most PAGE rows a request; a page short of that is the last.
  for (let from = 0; ; from += PAGE) {
    const page = await supabase
      .from("riftbound_collection")
      .select("printing:printing_id, finish, condition, quantity, for_trade, lendable")
      .eq("user_id", me.data as string)
      .order("printing_id")
      .order("finish")
      .order("condition")
      .range(from, from + PAGE - 1);
    if (page.error) return null;
    copies.push(...page.data);
    if (page.data.length < PAGE) break;
  }
  return {
    me: me.data as string,
    copies,
    lends: lending.data?.lends ?? false,
    lendAll: lending.data?.lend_default === "everything",
  };
}

interface Lender {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  copies: number;
}

/** The global Riftbound catalogue: not per server, so no guild filter; RLS lets anyone logged in read it. */
export async function CardLibrary() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return <LogInPrompt text={LOG_IN} />;
  const [{ data, error }, collection] = await Promise.all([
    supabase.from("riftbound_cards").select("*, printings:riftbound_printings(*)").order("id").limit(MAX_CARDS),
    myCollection(supabase),
  ]);
  if (error) return <ErrorState title="Could not load the cards">Try again in a minute.</ErrorState>;
  const cards = (data as Card[]).map((c) => ({ ...c, printings: c.printings.toSorted(byNumber) }));
  // Collector order, as in a binder; a card without printings goes last.
  const first = (c: Card) => c.printings[0]?.collector_number ?? Infinity;
  const library: LibraryCard[] = cards
    .toSorted((a, b) => first(a) - first(b) || a.name.localeCompare(b.name))
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      domains: c.domains,
      energy: c.energy,
      tags: c.tags,
      placeholder: c.placeholder,
      sets: [...new Set(c.printings.map((p) => p.set_code))],
      codes: c.printings.map((p) => p.collector_code),
      printings: c.printings.map((p) => ({ id: p.id, set_code: p.set_code })),
      image_url: c.printings.find((p) => p.image_url)?.image_url ?? null,
    }));
  return <CardGrid cards={library} collection={collection} />;
}

/** One card with every printing of it. */
export async function CardDetail({ id }: { id: string }) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return <LogInPrompt text={LOG_IN} />;
  const [{ data, error }, collection, lenders] = await Promise.all([
    supabase.from("riftbound_cards").select("*, printings:riftbound_printings(*)").eq("id", id).maybeSingle<Card>(),
    myCollection(supabase),
    supabase.rpc("riftbound_lenders", { card: id }),
  ]);
  if (error) return <ErrorState title="Could not load this card">Try again in a minute.</ErrorState>;
  if (!data) notFound();
  const printings = data.printings.toSorted(byNumber);
  const dash = (n: number | null) => (n === null ? "-" : String(n));
  const stats = [
    ["Type", [...data.supertypes, data.type].join(" ")],
    ["Cost", dash(data.energy)],
    ["Might", dash(data.might)],
    ["Domains", data.domains.join(", ") || "-"],
    ["Tags", data.tags.join(", ") || "-"],
  ];
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
          <CardImage url={printings.find((p) => p.image_url)?.image_url ?? null} eager />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="break-words text-4xl font-semibold">{data.name}</h1>
            {/* Made up until Riot approves the API key: nobody may mistake it for a real card. */}
            {data.placeholder && (
              <Badge variant="secondary" className="w-fit">
                Placeholder card
              </Badge>
            )}
          </div>
          {data.rules_text && <p className="text-muted-foreground">{data.rules_text}</p>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {stats.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <StatCard
        title="Printings"
        description={`${printings.length.toLocaleString("en-US")} ${printings.length === 1 ? "printing" : "printings"}`}
      >
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {printings.map((p) => (
            <li key={p.id} className="flex min-w-0 flex-col gap-2">
              <CardImage url={p.image_url} />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-sm font-medium">{p.collector_code}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {[p.set_code, p.rarity, p.illustrator].filter(Boolean).join(" · ")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </StatCard>
      {collection && <CopiesEditor printings={printings.map((p) => ({ id: p.id, code: p.collector_code }))} collection={collection} />}
      <StatCard title="Who has it?" description="People in your servers with copies to lend">
        {lenders.error ? (
          <p className="text-sm text-muted-foreground">Could not load who has it. Try again in a minute.</p>
        ) : lenders.data.length === 0 ? (
          <EmptyState>Nobody in your servers lends this card yet.</EmptyState>
        ) : (
          <RankList>
            {(lenders.data as Lender[]).map((l, i) => (
              <MemberRankRow
                key={l.user_id}
                rank={i + 1}
                name={l.display_name}
                avatarUrl={l.avatar_url}
                href={`/u/${l.user_id}`}
                value={`${l.copies} to lend`}
              />
            ))}
          </RankList>
        )}
      </StatCard>
    </>
  );
}
