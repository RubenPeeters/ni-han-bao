import { answerLoan } from "@/app/u/[userId]/actions";
import { ProfileHeader, type Profile } from "@/components/profile-stats";
import { EmptyState, ErrorState, StatCard } from "@/components/stat-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { languageName } from "@/lib/collection";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

/** A row of profile_loans(), from the visitor's side: `lent` is true for their own cards. */
interface Loan {
  id: number;
  lent: boolean;
  other_id: string;
  /** Null when the other member is hidden in every server. */
  other_name: string | null;
  other_avatar: string | null;
  due_on: string | null;
  state: "open" | "returned" | "written_off";
  answer: "confirmed" | "disputed" | null;
  note: string | null;
  cards: { name: string; code: string; finish: string; condition: string; language: string; quantity: number }[];
  /** The deck it lent whole, by its name then. */
  deck_name: string | null;
}

const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * A profile's Loans tab: the visitor's own loans with the profile's owner, so all of them on
 * your own profile. profile_loans() leaves out everyone who is not a party to a loan.
 */
export async function ProfileLoans({ user }: { user: string }) {
  const supabase = await createClient();
  const [profile, loans] = await Promise.all([
    supabase.rpc("profile", { u: user }).maybeSingle<Profile>(),
    supabase.rpc("profile_loans", { u: user }),
  ]);
  if (profile.error || loans.error) return <ErrorState title="Could not load these loans">Try again in a minute.</ErrorState>;
  // Private, hidden, forgotten or unknown: the same 404 as the other tabs.
  if (!profile.data) notFound();
  const { mine } = profile.data;
  const rows = loans.data as Loan[];
  const today = new Date().toISOString().slice(0, 10);
  const sections = [
    { title: mine ? "Who has my cards" : "Your cards they have", description: "Lent and not back yet", loans: rows.filter((l) => l.state === "open" && l.lent) },
    { title: mine ? "What I owe" : "What you owe them", description: "Borrowed and not given back yet", loans: rows.filter((l) => l.state === "open" && !l.lent) },
    { title: "Closed", description: "Returned or written off", loans: rows.filter((l) => l.state !== "open") },
  ].filter((s) => s.loans.length > 0);
  return (
    <>
      <ProfileHeader
        user={user}
        profile={profile.data}
        subtitle={mine ? "Riftbound cards you lent and borrowed." : "Riftbound cards lent between you and them."}
      />
      {sections.length === 0 ? (
        <EmptyState>
          {mine
            ? "No loans yet. Lend cards with /lend in Discord, or a deck on its page; the borrower confirms."
            : "No loans between you and them."}
        </EmptyState>
      ) : (
        sections.map((s) => (
          <StatCard key={s.title} title={s.title} description={s.description}>
            <ul className="flex flex-col divide-y">
              {s.loans.map((l) => (
                <LoanRow key={l.id} loan={l} today={today} />
              ))}
            </ul>
          </StatCard>
        ))
      )}
      <p className="text-xs text-muted-foreground">
        Only you and the other member of a loan see it. Record loans with /lend (or a deck on its page) and returns with /return in Discord.
      </p>
    </>
  );
}

function LoanRow({ loan, today }: { loan: Loan; today: string }) {
  const name = loan.other_name ?? "A hidden member";
  const open = loan.state === "open";
  return (
    <li className="flex flex-col gap-3 py-4 text-sm first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        {loan.other_avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={loan.other_avatar} alt="" width={32} height={32} className="size-8 shrink-0 rounded-full bg-muted object-cover" />
        ) : (
          <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{loan.lent ? `With ${name}` : `From ${name}`}</span>
          <span className="text-xs text-muted-foreground">
            Loan #{loan.id}
            {loan.deck_name && ` · deck ${loan.deck_name}`}
            {loan.due_on && open && ` · due ${day(loan.due_on)}`}
            {loan.state === "written_off" && " · written off"}
            {loan.state === "returned" && " · returned"}
          </span>
        </span>
        <span className="flex flex-wrap gap-2">
          {open && loan.due_on && loan.due_on < today && <Badge variant="destructive">Overdue</Badge>}
          {open && loan.answer === null && <Badge variant="outline">Unconfirmed</Badge>}
          {loan.answer === "disputed" && <Badge variant="destructive">Disputed</Badge>}
        </span>
      </div>
      <ul className="flex flex-col gap-1 pl-11">
        {loan.cards.map((c) => (
          <li key={`${c.code} ${c.finish} ${c.condition} ${c.language}`} className="flex min-w-0 flex-wrap gap-x-2">
            <span className="tabular-nums">{c.quantity} ×</span>
            <span className="min-w-0 break-words">{c.name}</span>
            <span className="text-muted-foreground">
              {[c.code, c.finish === "foil" && "foil", c.condition !== "NM" && c.condition, c.language !== "en" && languageName(c.language)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      {open && !loan.lent && loan.answer !== "confirmed" && <AnswerForms loan={loan.id} />}
      {loan.answer === "disputed" && (
        <dl className="ml-11 flex flex-col gap-2 rounded-md bg-muted p-3">
          <div>
            <dt className="text-xs text-muted-foreground">{loan.lent ? "You recorded" : `${name} recorded`}</dt>
            <dd>The cards above.</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{loan.lent ? `${name} says` : "You said"}</dt>
            <dd className="break-words">{loan.note}</dd>
          </div>
        </dl>
      )}
    </li>
  );
}

/** The borrower's Confirm and Dispute, as the buttons under /lend in Discord. */
function AnswerForms({ loan }: { loan: number }) {
  return (
    <div className="flex flex-col gap-2 pl-11 sm:flex-row sm:items-start">
      <form action={answerLoan}>
        <input type="hidden" name="loan" value={loan} />
        <input type="hidden" name="kind" value="confirmed" />
        <Button type="submit" size="sm" className="h-11">
          Confirm: I have them
        </Button>
      </form>
      <details className="min-w-0 flex-1">
        <summary className="flex h-11 cursor-pointer items-center rounded-md text-sm text-muted-foreground hover:text-foreground">Dispute</summary>
        <form action={answerLoan} className="flex flex-col gap-2 pt-2">
          <input type="hidden" name="loan" value={loan} />
          <input type="hidden" name="kind" value="disputed" />
          <label className="flex flex-col gap-2 text-sm font-medium">
            What is different? The lender sees this.
            <textarea
              name="note"
              required
              maxLength={300}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-base font-normal shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </label>
          <Button type="submit" variant="secondary" size="sm" className="h-11 self-start">
            Send dispute
          </Button>
        </form>
      </details>
    </div>
  );
}
