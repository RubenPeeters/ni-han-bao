import { PageHeader } from "@/components/stat-ui";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "Terms of service · nexus",
  description: "The rules for using the nexus bot and website.",
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

export default function TermsPage() {
  return (
    <>
      <PageHeader
        title="Terms of service"
        description="The rules for using the nexus bot and website, in plain language."
      />
      <Section title="The service">
        <p>
          nexus is a free hobby project. By adding the bot to a server or using this website,
          you agree to these terms. What the bot collects and who can see it is on{" "}
          <Link
            href="/about"
            className="font-medium underline underline-offset-4 hover:text-gold"
          >
            About &amp; privacy
          </Link>
          .
        </p>
        <p>
          It is provided as is, without any warranty. It may be down, count something wrong, lose
          data, change, or stop altogether, at any time and without notice. We are not liable for
          any loss or damage that comes from using it.
        </p>
      </Section>
      <Section title="What is not allowed">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>Abusing the bot or the website, or using them to harass anyone.</li>
          <li>
            Scraping the website, or reading it automatically in bulk, instead of using it as a
            visitor.
          </li>
          <li>
            Trying to get at data you are not allowed to see, or to break or overload the service.
          </li>
          <li>Using it in a way that breaks Discord&apos;s Terms of Service or the law.</li>
        </ul>
      </Section>
      <Section title="Removing the bot">
        <p>
          We can remove the bot from any server, and block anyone from the website, at any time and
          for any reason, for example after a breach of these terms.
        </p>
        <p>A server admin can remove the bot at any time by kicking it like any member.</p>
      </Section>
      <Section title="Changes and contact">
        <p>
          These terms may change; the version on this page is the one that applies. Questions?{" "}
          <a
            href={`${REPO}/issues`}
            className="font-medium underline underline-offset-4 hover:text-gold"
          >
            Open an issue on GitHub
          </a>
          .
        </p>
      </Section>
    </>
  );
}
