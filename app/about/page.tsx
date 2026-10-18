import { PageHeader } from "@/components/stat-ui";
import type { ReactNode } from "react";

export const metadata = {
  title: "About & privacy · ni han bao",
  description: "What the bot counts, who can see it, and how to opt out.",
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
        description="What the bot counts, who can see it, and how to opt out."
      />
      <Section title="What the bot counts">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>Messages: how many, per member, per channel and per hour.</li>
          <li>Reactions and emoji: which ones are used, and by whom.</li>
          <li>Voice: how long members spend in voice channels.</li>
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
          members of a server can see your name and stats on that server&apos;s pages.
        </p>
        <p>
          Logging in stores your Discord id, name, avatar and email address. The email comes
          with every Discord login through our login provider (Supabase); the site does not use
          it.
        </p>
      </Section>
      <Section title="Hiding yourself">
        <p>
          Type <Cmd>/hide-me</Cmd> in a server to disappear from that server&apos;s lists and
          charts on the website. <Cmd>/show-me</Cmd> brings you back. It applies per server, so
          run it in each server you want to hide from. Your messages still count towards the
          server&apos;s totals, without your name.
        </p>
        <p>
          To remove the bot from a server, a server admin can kick it like any member (or via
          Server Settings → Integrations). It stops counting immediately and the server
          disappears from the server picker. Statistics already collected are kept; ask below
          if you want them deleted.
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
      </Section>
    </>
  );
}
