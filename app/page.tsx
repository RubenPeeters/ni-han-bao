import { BotAvatar, HeroAvatar, HeroStatus, StatusPill } from "@/components/bot-status";
import { Heatmap } from "@/components/channel-stats";
import { TopEmoji } from "@/components/emoji-stats";
import { HomeStats, HomeStatsSkeleton } from "@/components/home-stats";
import { Board } from "@/components/leaderboard";
import { HomeFeed } from "@/components/home-feed";
import { NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { LoanRow, type Loan } from "@/components/profile-loans";
import { MemberRankRow, RankList, RankRow, StatCard } from "@/components/stat-ui";
import { Button } from "@/components/ui/button";
import { parseFilter, parseShow } from "@/lib/feed";
import { createClient } from "@/lib/supabase/server";
import { hasEnvVars, INSTALL_URL } from "@/lib/utils";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

// Drafts for Ruben: every text of the logged-out landing page, in one place to edit.
const COPY = {
  title: "nexus: Riftbound cards for your playgroup",
  description: "A Riftbound collection, lending and trade tool for playgroups on Discord, with server statistics.",
  hero: "Your playgroup's Riftbound cards in one place: who owns what, what you can borrow, and who has the card you are looking for.",
  start: "Start your collection",
  install: "Add to Discord",
  collection: { title: "Your collection", text: "Count your cards by printing, finish and language. Import a CSV, export it again." },
  loans: { title: "Lend and borrow", text: "See which cards your group can lend, ask for them, and keep track of what is out and when it is due." },
  trades: { title: "Trades and wishlists", text: "Add what you are looking for. When someone in your server has it for trade, you both hear about it." },
  alone: "You can keep a collection on your own. Lending and trades start when the bot is in a server you share with other players.",
  stats: "And your server's numbers",
  leaderboard: { title: "A leaderboard for every server", text: "Who sent the most messages this week, and of all time. Members click through to their own stats." },
  heatmap: { title: "When your server is awake", text: "Messages by weekday and hour, in your server's time zone, so you know when to post." },
  emoji: { title: "The emoji people actually use", text: "The most used reactions, and whose messages get the most of them." },
};

export const metadata = { title: COPY.title, description: COPY.description };

// Made-up example data: the previews render the real cards, but no real server or person.
const EXAMPLE_TALKERS = [
  ["Mira", 1284],
  ["Jonas", 1102],
  ["Sam", 876],
  ["Ayla", 640],
  ["Teo", 512],
].map(([name, count], i) => ({
  user_id: String(i),
  display_name: name as string,
  avatar_url: null,
  message_count: count as number,
}));

const EXAMPLE_EMOJI = [
  ["😂", 2310],
  ["👍", 1745],
  ["🔥", 980],
  ["💀", 702],
  ["❤️", 655],
].map(([name, count]) => ({
  emoji_key: name as string,
  emoji_id: null,
  name: name as string,
  animated: false,
  reaction_count: count as number,
}));

const EXAMPLE_SETS = [
  ["OGN · Origins", 214, 151],
  ["SFD · Spiritforged", 96, 72],
  ["OGS · Proving Grounds", 24, 24],
] as const;

// Fixed dates, so the "Overdue" badge does not depend on the day the page is built.
const EXAMPLE_TODAY = "2026-11-10";
const EXAMPLE_LOANS: Loan[] = [
  {
    other: "Jonas",
    due_on: "2026-11-21",
    cards: [
      { name: "Jinx, Loose Cannon", code: "OGN-202", finish: "normal", quantity: 1 },
      { name: "Get Excited!", code: "OGN-008", finish: "foil", quantity: 3 },
    ],
  },
  { other: "Ayla", due_on: "2026-11-03", cards: [{ name: "Ahri, Alluring", code: "OGN-066", finish: "normal", quantity: 2 }] },
].map(({ other, due_on, cards }, i) => ({
  id: 12 + i,
  lent: true,
  other_id: String(i),
  other_name: other,
  other_avatar: null,
  due_on,
  state: "open",
  answer: "confirmed",
  note: null,
  cards: cards.map((c) => ({ ...c, condition: "NM", language: "en" })),
  deck_name: null,
}));

const EXAMPLE_TRADES = [
  { card: "Yasuo, Unforgiven", want: 1, traders: [["Mira", 1, "You are both going: Sat 15 Nov 13:00 · Weekly league"]] },
  { card: "Fight or Flight", want: 2, traders: [["Sam", 2, "You are both regulars at the card shop in town"], ["Teo", 1, "No shared event or store yet: ask in the server"]] },
] as const;

// Quiet nights, a busy evening peak, a little more at the weekend.
const EXAMPLE_HEATMAP = Array.from({ length: 7 }, (_, d) =>
  Array.from({ length: 24 }, (_, h) =>
    h < 7 ? (h < 2 ? 4 : 0) : Math.round(8 + 40 * Math.exp(-((h - 21) ** 2) / 10) + (d >= 4 ? 10 : 0)),
  ),
);

export default function Home({ searchParams }: PageProps<"/">) {
  if (!hasEnvVars) return <Landing />;
  return (
    <Suspense fallback={<StatsSkeleton cards={2} wide />}>
      <HomeForVisitor searchParams={searchParams} />
    </Suspense>
  );
}

// Logged in: what is going on in their servers, not the pitch for the bot they already use.
async function HomeForVisitor({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return <Landing />;
  const { filter, show } = await searchParams;
  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader title="Home" description="What is going on in the servers you are in." />
        <Button asChild variant="outline" size="sm" className="self-start sm:self-auto">
          <a href={INSTALL_URL}>Add to Discord</a>
        </Button>
      </div>
      <HomeFeed filter={parseFilter(filter)} show={parseShow(show)} />
    </>
  );
}

function Landing() {
  return (
    <>
      <section className="hero-dim flex flex-col items-center gap-5 py-6 text-center sm:flex-row sm:items-center sm:gap-8 sm:text-left">
        {hasEnvVars ? (
          <Suspense fallback={<BotAvatar url={null} />}>
            <HeroAvatar />
          </Suspense>
        ) : (
          <BotAvatar url={null} />
        )}
        <div className="flex flex-col items-center gap-3 sm:items-start">
          <h1 className="text-4xl font-semibold">nexus</h1>
          <p className="text-lg text-muted-foreground">{COPY.hero}</p>
          {hasEnvVars ? (
            <Suspense fallback={<StatusPill tone="unknown">Checking…</StatusPill>}>
              <HeroStatus />
            </Suspense>
          ) : (
            <StatusPill tone="unknown">Status unknown</StatusPill>
          )}
          <div className="mt-2 flex min-h-10 flex-wrap justify-center gap-3 sm:justify-start">
            <Button asChild size="lg">
              <Link href="/collection">{COPY.start}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={INSTALL_URL}>{COPY.install}</a>
            </Button>
          </div>
        </div>
      </section>

      <Feature {...COPY.collection}>
        <StatCard title="Per set" description="334 copies in all">
          <RankList>
            {EXAMPLE_SETS.map(([set, copies, cards], i) => (
              <RankRow key={set} rank={i + 1} value={copies.toLocaleString("en-US")}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{set}</span>
                  <span className="text-xs text-muted-foreground">{cards} different cards</span>
                </span>
              </RankRow>
            ))}
          </RankList>
        </StatCard>
      </Feature>
      <Feature {...COPY.loans}>
        <StatCard title="Who has my cards" description="Lent and not back yet">
          <ul className="flex flex-col divide-y">
            {EXAMPLE_LOANS.map((l) => (
              <LoanRow key={l.id} loan={l} today={EXAMPLE_TODAY} byCode={new Map()} />
            ))}
          </ul>
        </StatCard>
      </Feature>
      <Feature {...COPY.trades}>
        <StatCard title="Trade matches" description="Cards on your wishlist that other members have for trade">
          {EXAMPLE_TRADES.map((m) => (
            <div key={m.card} className="flex min-w-0 flex-col gap-2">
              <h3 className="flex items-center justify-between gap-3 text-sm font-medium">
                <span className="truncate">{m.card}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">You want {m.want}</span>
              </h3>
              <RankList>
                {m.traders.map(([name, copies, meet], i) => (
                  <MemberRankRow
                    key={name}
                    rank={i + 1}
                    name={name}
                    avatarUrl={null}
                    value={`${copies} for trade`}
                    detail={<span className="truncate">{meet}</span>}
                  />
                ))}
              </RankList>
            </div>
          ))}
        </StatCard>
      </Feature>
      <p className="text-muted-foreground">{COPY.alone}</p>

      <h2 className="border-t pt-8 text-4xl font-semibold">{COPY.stats}</h2>
      <Feature {...COPY.leaderboard}>
        <Board title="This week" description="Since Monday" rows={EXAMPLE_TALKERS} />
      </Feature>
      <Feature {...COPY.heatmap}>
        <Heatmap grid={EXAMPLE_HEATMAP} timeZone="UTC" />
      </Feature>
      <Feature {...COPY.emoji}>
        <TopEmoji rows={EXAMPLE_EMOJI} />
      </Feature>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Across all servers</h2>
        {hasEnvVars ? (
          <Suspense fallback={<HomeStatsSkeleton />}>
            <HomeStats />
          </Suspense>
        ) : (
          <NotConfigured />
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Questions</h2>
        <Faq question="What does it count?">
          Messages per member, channel and hour, reactions and emoji, time in voice channels, and
          joins and leaves. It keeps counts, timestamps, ids and names, never what a message says:
          it does not even have Discord&apos;s permission to read message content.
        </Faq>
        <Faq question="Who can see the stats?">
          Only members of a server, after logging in with Discord, see that server&apos;s pages.
          Logged out, this site shows totals across all servers and nothing else.
        </Faq>
        <Faq question="Can I hide myself?">
          Type <Cmd>/hide-me</Cmd> in a server to disappear from its lists and charts;{" "}
          <Cmd>/show-me</Cmd> brings you back. <Cmd>/forget-me</Cmd> deletes everything the bot
          stored about you.
        </Faq>
        <Faq question="How do I remove the bot?">
          A server admin can kick it like any member, or remove it in Server Settings →
          Integrations. It stops counting straight away.
        </Faq>
        <p className="text-sm text-muted-foreground">
          More in the{" "}
          <Link href="/docs" className="font-medium text-crystal underline underline-offset-4 hover:text-crystal/80">
            docs
          </Link>{" "}
          and in{" "}
          <Link href="/about" className="font-medium text-crystal underline underline-offset-4 hover:text-crystal/80">
            About &amp; privacy
          </Link>
          .
        </p>
      </section>
    </>
  );
}

function Feature({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">{title}</h2>
        <p className="text-muted-foreground">{text}</p>
      </div>
      <figure className="flex flex-col gap-2">
        {children}
        <figcaption className="text-xs text-muted-foreground">Example with made-up data.</figcaption>
      </figure>
    </section>
  );
}

function Faq({ question, children }: { question: string; children: ReactNode }) {
  return (
    <section className="card flex flex-col gap-2 text-sm leading-relaxed">
      <h3 className="text-base font-semibold">{question}</h3>
      <p>{children}</p>
    </section>
  );
}

function Cmd({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>;
}
