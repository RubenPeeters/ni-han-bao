import { BotAvatar, HeroAvatar, HeroStatus, StatusPill } from "@/components/bot-status";
import { Heatmap } from "@/components/channel-stats";
import { TopEmoji } from "@/components/emoji-stats";
import { HomeStats, HomeStatsSkeleton } from "@/components/home-stats";
import { Board } from "@/components/leaderboard";
import { MyServers } from "@/components/server-picker";
import { NotConfigured, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { ServersButton } from "@/components/auth-button";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { hasEnvVars } from "@/lib/utils";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

// View Channels, Send Messages, Embed Links (the report cards), Attach Files (the monthly
// recap image) and Read Message History (counting past messages). Slash commands need the
// applications.commands scope.
const INSTALL_URL =
  "https://discord.com/oauth2/authorize?client_id=1561027678838980680&permissions=117760&scope=bot+applications.commands";

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

// Quiet nights, a busy evening peak, a little more at the weekend.
const EXAMPLE_HEATMAP = Array.from({ length: 7 }, (_, d) =>
  Array.from({ length: 24 }, (_, h) =>
    h < 7 ? (h < 2 ? 4 : 0) : Math.round(8 + 40 * Math.exp(-((h - 21) ** 2) / 10) + (d >= 4 ? 10 : 0)),
  ),
);

export default function Home() {
  if (!hasEnvVars) return <Landing />;
  return (
    <Suspense fallback={<StatsSkeleton cards={2} />}>
      <HomeForVisitor />
    </Suspense>
  );
}

// Logged in: their servers first, not the pitch for the bot they already use.
async function HomeForVisitor() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return <Landing />;
  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader title="Your servers" description="This week in the servers you are in." />
        <Button asChild variant="outline" size="sm" className="self-start sm:self-auto">
          <a href={INSTALL_URL}>Add to Discord</a>
        </Button>
      </div>
      <MyServers />
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
          <h1 className="text-4xl font-semibold">ni han bao</h1>
          <p className="text-lg text-muted-foreground">
            A Discord bot that counts messages, reactions and voice time, and shows who talks the
            most.
          </p>
          {hasEnvVars ? (
            <Suspense fallback={<StatusPill tone="unknown">Checking…</StatusPill>}>
              <HeroStatus />
            </Suspense>
          ) : (
            <StatusPill tone="unknown">Status unknown</StatusPill>
          )}
          <div className="mt-2 flex min-h-10 flex-wrap justify-center gap-3 sm:justify-start">
            <Button asChild size="lg">
              <a href={INSTALL_URL}>Add to Discord</a>
            </Button>
            <ServersButton />
          </div>
        </div>
      </section>

      <Feature
        title="A leaderboard for every server"
        text="Who sent the most messages this week, and of all time. Members click through to their own stats."
      >
        <Board title="This week" description="Since Monday" rows={EXAMPLE_TALKERS} />
      </Feature>
      <Feature
        title="When your server is awake"
        text="Messages by weekday and hour, in your server's time zone, so you know when to post."
      >
        <Heatmap grid={EXAMPLE_HEATMAP} timeZone="UTC" />
      </Feature>
      <Feature
        title="The emoji people actually use"
        text="The most used reactions, and whose messages get the most of them."
      >
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
          <Link href="/docs" className="font-medium underline underline-offset-4 hover:text-primary">
            docs
          </Link>{" "}
          and in{" "}
          <Link href="/about" className="font-medium underline underline-offset-4 hover:text-primary">
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
