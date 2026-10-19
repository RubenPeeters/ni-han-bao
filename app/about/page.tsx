import { PageHeader } from "@/components/stat-ui";
import { RIOT_DISCLAIMER } from "@/lib/utils";
import type { ReactNode } from "react";

export const metadata = {
  title: "About & privacy · ni han bao",
  description: "What the bot counts, who can see it, and how to opt out or delete your data.",
};

const REPO = "https://github.com/RubenPeeters/ni-han-bao";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card flex flex-col gap-3 text-sm leading-relaxed">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Cmd({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>;
}

export default function AboutPage() {
  return (
    <>
      <PageHeader
        title="About & privacy"
        description="What the bot counts, who can see it, and how to opt out or delete your data."
      />
      <Section title="What the bot counts">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>Messages: how many, per member, per channel and per hour.</li>
          <li>Reactions and emoji: which ones are used, and by whom.</li>
          <li>Voice: how long members spend in voice channels.</li>
          <li>
            Games: from your Discord status, the name of the game you are playing or competing
            in, or that you are streaming, and for how long, per day. The game&apos;s Discord
            application id is kept with the game, not with you, to show its icon. Nothing else from
            your status is stored: no rich presence details, no Spotify songs, no custom status.
          </li>
          <li>
            League ranks: only if you link your League account with <Cmd>/lol link</Cmd>, Riot&apos;s
            official tier, division and LP for Solo/Duo and Flex, every 3 hours. They show on your
            profile and on the Ranked page of your servers. <Cmd>/lol unlink</Cmd> deletes them.
          </li>
          <li>
            League games: with a linked account, your ranked and normal games of the last 10 days (the
            champion you played and when), every 6 hours, for the weekly report, the Ranked page and
            your profile (your most played champion). Custom games are never fetched.
            <Cmd>/lol unlink</Cmd> deletes them.
          </li>
          <li>
            Riftbound cards: only what you enter yourself on the Cards page or with{" "}
            <Cmd>/collection add</Cmd>, how many of each you own (finish and condition), how many are
            for trade and how many you lend. Your profile&apos;s Collection tab shows totals per set
            and rarity. With <Cmd>/collection lending on</Cmd>, members of your servers see your
            copies to lend on a card&apos;s page, unless your profile is private.
          </li>
          <li>Joins and leaves.</li>
        </ul>
        <p>
          Along with those counts it keeps ids, timestamps, and server, channel and member
          names and avatars. It never stores what a message says: the bot does not even have
          Discord&apos;s permission to read message content.
        </p>
      </Section>
      <Section title="Who can see what">
        <p>
          Logged out, you only see totals across all servers: no server names, no member names,
          nothing about a single person.
        </p>
        <p>
          Logged in with Discord, you see the servers you are a member of, and only those. Other
          members of a server can see your name and stats on that server&apos;s pages. Game
          time is the exception: a server&apos;s game totals count everyone, but its Playing now
          list only names members whose profile is not private.
        </p>
        <p>
          Your profile page, which brings your servers together, is private until you change it
          there or with <Cmd>/profile visibility</Cmd>: only you, people who share a server
          with you (for the servers you share), or anyone logged in (your name; stats only for
          the servers you share). While you are hidden with{" "}
          <Cmd>/hide-me</Cmd> in a server, nobody else sees it.
        </p>
        <p>
          Logging in stores your Discord id, name, avatar and email address. The email comes
          with every Discord login through our login provider (Supabase); the site does not use
          it.
        </p>
      </Section>
      <Section title="Hiding or deleting your data">
        <p>
          Type <Cmd>/hide-me</Cmd> in a server to disappear from that server&apos;s lists and
          charts on the website. <Cmd>/show-me</Cmd> brings you back. It applies per server, so
          run it in each server you want to hide from. Your messages still count towards the
          server&apos;s totals, without your name. Game time is not counted at all while you
          are hidden in any server.
        </p>
        <p>
          To have your data deleted instead, type <Cmd>/forget-me</Cmd> in any server and
          confirm. It deletes everything the bot stored about you, in every server: your
          message, reaction and voice counts, your game time, your name and avatar, your server memberships, your
          linked League account with its ranks and games, your Riftbound collection, your profile and lending settings and your <Cmd>/hide-me</Cmd> setting. Server totals such as messages per channel keep
          their counts, without anything that points to you. The bot then stops counting you,
          keeping only a scrambled (hashed) copy of your Discord id to recognise you by. Until
          you type <Cmd>/show-me</Cmd>, which starts counting you again, you also cannot open
          your servers&apos; pages here.
        </p>
        <p>
          To remove the bot from a server, a server admin can kick it like any member (or via
          Server Settings → Integrations). It stops counting immediately and the server
          disappears from the server picker. Statistics already collected are kept; ask below
          if you want them deleted.
        </p>
      </Section>
      <Section title="Numbers about the site">
        <p>
          To learn whether anyone visits and which pages matter, the website uses Vercel Web
          Analytics. It sets no cookies and does not follow you across sites or days: it counts
          page views per page, with the referring site, country, browser and device type. Server
          ids in the address are kept, so we can see how many servers are looked at each week;
          member ids are cut out first.
        </p>
        <p>
          From the bot&apos;s own data we also watch, once a month: how many servers have the
          bot, how many set it up with <Cmd>/setup</Cmd>, and how many monthly recaps it posts.
        </p>
      </Section>
      <Section title="Who runs it">
        <p>
          ni han bao is a hobby project by Ruben. Questions, or a request to delete data?{" "}
          <a
            href={`${REPO}/issues`}
            className="font-medium underline underline-offset-4 hover:text-primary"
          >
            Open an issue on GitHub
          </a>
          . The code is public there too.
        </p>
        <p>{RIOT_DISCLAIMER}</p>
      </Section>
    </>
  );
}
