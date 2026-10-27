import { AnswerRequest, CancelRequest } from "@/components/borrow-request";
import { CardThumb } from "@/components/card-thumb";
import { ErrorState, StatCard } from "@/components/stat-ui";
import { Badge } from "@/components/ui/badge";
import { languageName } from "@/lib/collection";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

/** A row of my_borrow_requests(), from the visitor's side: `asked` is true for those they sent. */
interface Request {
  id: number;
  asked: boolean;
  other_id: string;
  /** Null when the other member is hidden in every server. */
  other_name: string | null;
  other_avatar: string | null;
  languages: string[];
  wanted_by: string | null;
  note: string | null;
  state: "open" | "accepted" | "declined" | "cancelled";
  loan_id: number | null;
  answer_note: string | null;
  /** The lender's DM could not be delivered. */
  dm_failed: boolean;
  cards: { card_id: string; name: string; quantity: number }[];
}

const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * /loans' borrow requests: those asked of the visitor, with Accept and Decline as the
 * bot's DM has them (so DMs closed do not stop them), and the visitor's own, with Cancel while open.
 * Nothing at all without any.
 */
export async function BorrowRequests() {
  const supabase = await createClient();
  const requests = await supabase.rpc("my_borrow_requests");
  if (requests.error) return <ErrorState title="Could not load your borrow requests">Try again in a minute.</ErrorState>;
  const rows = requests.data as Request[];
  const images = await supabase
    .from("riftbound_printings")
    .select("card_id, image_url")
    .in("card_id", [...new Set(rows.flatMap((r) => r.cards.map((c) => c.card_id)))])
    .not("image_url", "is", null)
    .order("id");
  // Pictures are decoration: without them the requests still show.
  const image = new Map<string, string>();
  for (const p of images.data ?? []) if (!image.has(p.card_id)) image.set(p.card_id, p.image_url);
  const sections = [
    { title: "Requests", description: "Members asking to borrow your cards", rows: rows.filter((r) => !r.asked && r.state === "open") },
    { title: "My requests", description: "What you asked to borrow, and the answers", rows: rows.filter((r) => r.asked) },
  ].filter((s) => s.rows.length > 0);
  return sections.map((s) => (
    <StatCard key={s.title} title={s.title} description={s.description}>
      <ul className="flex flex-col divide-y">
        {s.rows.map((r) => (
          <RequestRow key={r.id} request={r} image={image} />
        ))}
      </ul>
    </StatCard>
  ));
}

function RequestRow({ request: r, image }: { request: Request; image: Map<string, string> }) {
  const name = r.other_name ?? "A hidden member";
  return (
    <li className="flex flex-col gap-3 py-4 text-sm first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        {r.other_avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.other_avatar} alt="" width={32} height={32} className="size-8 shrink-0 rounded-full bg-muted object-cover" />
        ) : (
          <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{r.asked ? `Asked of ${name}` : `${name} asks`}</span>
          <span className="text-xs text-muted-foreground">
            Request #{r.id} · {r.languages.map(languageName).join(", ")}
            {r.wanted_by && ` · wanted by ${day(r.wanted_by)}`}
          </span>
        </span>
        <span className="flex flex-wrap gap-2">
          {r.state === "open" && r.asked && r.dm_failed && <Badge variant="outline">Not sent by DM</Badge>}
          {r.state === "declined" && <Badge variant="destructive">Declined</Badge>}
          {r.state === "cancelled" && <Badge variant="outline">Cancelled</Badge>}
          {r.state === "accepted" && <Badge variant="outline">Loan #{r.loan_id}</Badge>}
        </span>
      </div>
      <ul className="flex flex-col gap-2 pl-11">
        {r.cards.map((c) => (
          <li key={c.card_id}>
            <Link href={`/cards/${c.card_id}`} className="flex min-w-0 items-center gap-3 rounded-md hover:underline">
              <span className="w-12 shrink-0">
                <CardThumb url={image.get(c.card_id) ?? null} name="" width={48} />
              </span>
              <span className="break-words">
                <span className="tabular-nums">{c.quantity} ×</span> {c.name}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {(r.note || r.answer_note) && (
        <dl className="ml-11 flex flex-col gap-2 rounded-md bg-muted p-3">
          {r.note && (
            <div>
              <dt className="text-xs text-muted-foreground">{r.asked ? "You wrote" : `${name} wrote`}</dt>
              <dd className="break-words">{r.note}</dd>
            </div>
          )}
          {r.answer_note && (
            <div>
              <dt className="text-xs text-muted-foreground">{r.asked ? `${name} answered` : "You answered"}</dt>
              <dd className="break-words">{r.answer_note}</dd>
            </div>
          )}
        </dl>
      )}
      {r.state === "open" && (r.asked ? <CancelRequest request={r.id} /> : <AnswerRequest request={r} />)}
    </li>
  );
}
