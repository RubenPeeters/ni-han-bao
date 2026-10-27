import { setBorrowLanguages, setFeedCollection, setLending, setVisibility, setWishlistMode } from "@/app/u/[userId]/actions";
import { VISIBILITIES } from "@/components/profile-stats";
import { LogInPrompt } from "@/components/server-picker";
import { Checkboxes, Options, SettingsForm, ThemeSettings } from "@/components/settings-form";
import { ErrorState, PageHeader, StatsSkeleton } from "@/components/stat-ui";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { LANGUAGES } from "@/lib/collection";
import { hasEnvVars, cn } from "@/lib/utils";
import { WISHLIST_MODES } from "@/lib/wishlist";
import { Suspense, type ReactNode } from "react";

export const metadata = {
  title: "Settings · nexus",
  description: "Your settings for the site and the bot, in one place.",
};

// Each section has an anchor, so other pages link straight to it (/settings#riftbound).
const SECTIONS = [
  { id: "profile", title: "Profile" },
  { id: "riftbound", title: "Riftbound" },
  { id: "appearance", title: "Appearance" },
  { id: "linked-accounts", title: "Linked accounts" },
  { id: "servers", title: "Visibility per server" },
  { id: "delete", title: "Delete my data" },
] as const;

const LEND_DEFAULTS = [
  { value: "none", label: "Nothing until I mark cards", hint: "Set a count per card with To lend on the Cards page." },
  { value: "all", label: "Everything I own", hint: "Per-card counts still override it." },
];

const LOG_IN = "Log in to change your settings.";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description={metadata.description} />
      {hasEnvVars ? (
        <Suspense fallback={<StatsSkeleton cards={2} wide />}>
          <Settings />
        </Suspense>
      ) : (
        // No Supabase, no session: what a logged-out visitor sees.
        <LogInPrompt text={LOG_IN} />
      )}
    </>
  );
}

interface MySettings {
  visibility: string;
  lends_cards: boolean;
  lend_all: boolean;
  wishlist_mode: string | null;
  borrow_languages: string[];
  feed_collection: boolean;
}

async function Settings() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims) return <LogInPrompt text={LOG_IN} />;
  const me = await supabase.rpc("current_discord_id");
  const [profile, servers, accounts] = await Promise.all([
    // The caller's own row is always visible to them (can_see_profile()); no row is the defaults.
    supabase.from("profiles").select("visibility, lends_cards, lend_all, wishlist_mode, borrow_languages, feed_collection").eq("user_id", me.data ?? "").maybeSingle<MySettings>(),
    supabase.rpc("my_server_visibility"),
    supabase.rpc("my_game_accounts"),
  ]);
  // A failed read only takes down the sections that need it.
  const profileFailed = !!(me.error || profile.error);
  const mine = profile.data;
  const lol = (accounts.data as { game: string; region: string }[] | null)?.find((a) => a.game === "lol");
  const guilds = servers.data as { guild_id: string; name: string; hidden: boolean }[] | null;
  return (
    <>
      <nav aria-label="Settings sections">
        <ul className="-mx-2 flex flex-wrap">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="flex min-h-11 items-center rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Section id="profile" failed={profileFailed} description="Who can see your profile: your activity, collection, loans and wishlist.">
        <SettingsForm action={setVisibility}>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-2 text-sm font-medium">Who can see my profile</legend>
            <Options name="visibility" options={VISIBILITIES} value={mine?.visibility ?? "private"} />
          </fieldset>
          <Help>
            Also with <Cmd>/profile visibility</Cmd> in Discord. While you are hidden with <Cmd>/hide-me</Cmd>, nobody else sees it.
          </Help>
        </SettingsForm>
      </Section>

      <Section id="riftbound" failed={profileFailed} description="Lending, borrowing, how your decks count on your wishlist, and the home feed.">
        <SettingsForm action={setLending}>
          <label className="flex min-h-11 items-start gap-3 py-1 text-sm">
            <input type="checkbox" name="lends" defaultChecked={mine?.lends_cards ?? false} className="mt-0.5 size-4 shrink-0 accent-primary" />
            <span className="flex flex-col">
              <span className="font-medium">I lend cards</span>
              <span className="text-muted-foreground">
                Members of your servers see your copies to lend under Who has it? on a card&apos;s page. Off: nobody does.
              </span>
            </span>
          </label>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-2 text-sm font-medium">What I lend</legend>
            <Options name="default" options={LEND_DEFAULTS} value={mine?.lend_all ? "all" : "none"} />
          </fieldset>
          <Help>
            Also with <Cmd>/collection lending</Cmd> in Discord. A private profile is never listed.
          </Help>
        </SettingsForm>
        <hr />
        <SettingsForm action={setBorrowLanguages}>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-2 text-sm font-medium">Languages I accept when borrowing</legend>
            <Checkboxes name="languages" options={LANGUAGES.map((l) => ({ value: l.code, label: l.name }))} value={mine?.borrow_languages ?? ["en"]} />
          </fieldset>
          <Help>
            Who has it? lists copies in these first, and the others as also. A deck that takes only its own language
            uses that instead. Mixing languages is legal: this is only what you prefer.
          </Help>
        </SettingsForm>
        <hr />
        <SettingsForm action={setWishlistMode}>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-2 text-sm font-medium">How my new decks count on my wishlist</legend>
            <Options name="mode" options={WISHLIST_MODES} value={mine?.wishlist_mode ?? "shared"} />
          </fieldset>
          <Help>Decks you have now stay as they are: change one in its editor.</Help>
        </SettingsForm>
        <hr />
        <SettingsForm action={setFeedCollection}>
          <label className="flex min-h-11 items-start gap-3 py-1 text-sm">
            <input type="checkbox" name="feed" defaultChecked={mine?.feed_collection ?? true} className="mt-0.5 size-4 shrink-0 accent-primary" />
            <span className="flex flex-col">
              <span className="font-medium">Show my collection activity in the feed</span>
              <span className="text-muted-foreground">
                Members who may see your profile see how many cards you added each day. Off: nobody does, from earlier days too.
              </span>
            </span>
          </label>
        </SettingsForm>
      </Section>

      <Section id="appearance" description="Applies at once, on this device.">
        <ThemeSettings />
      </Section>

      <Section id="linked-accounts" failed={!!accounts.error} description="Accounts the bot knows are yours.">
        <dl className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <dt className="font-medium">League of Legends</dt>
          <dd>
            <Badge variant={lol ? "default" : "secondary"}>{lol ? `Linked (${lol.region.toUpperCase()})` : "Not linked"}</Badge>
          </dd>
        </dl>
        <Help>
          {lol ? (
            <>
              Change it in Discord: <Cmd>/lol unlink</Cmd> removes it, with its ranks and games, and <Cmd>/lol link</Cmd> links another.
            </>
          ) : (
            <>
              Link it in Discord with <Cmd>/lol link</Cmd>: proving the account is yours needs Discord.
            </>
          )}
        </Help>
      </Section>

      <Section id="servers" failed={!guilds} description="Whether you appear in each server's lists and charts. Only the bot changes it.">
        {guilds?.length === 0 ? (
          <p className="text-sm text-muted-foreground">The bot is not in any of your servers yet.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {guilds?.map((g) => (
              <li key={g.guild_id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm first:pt-0 last:pb-0">
                <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
                <Badge variant={g.hidden ? "secondary" : "outline"}>{g.hidden ? "Hidden" : "Shown"}</Badge>
                <span className="w-full text-muted-foreground">
                  {g.hidden ? "Show yourself again" : "Hide yourself"} with <Cmd>{g.hidden ? "/show-me" : "/hide-me"}</Cmd> in this server.
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Destructive, so last and set apart. */}
      <Section
        id="delete"
        description="Deleting happens in Discord only."
        className="mt-6 border-destructive/50 bg-destructive/5"
      >
        <p className="text-sm">
          <Cmd>/forget-me</Cmd> in Discord deletes everything the bot stores about you, in every server: your counts, name
          and avatar, linked accounts, Riftbound collection, decks, wishlist and loans, and these settings. Server totals keep
          their counts, without anything pointing to you. It asks first, and only you see the question.
        </p>
        <Help>
          The bot then stops counting you. Until you type <Cmd>/show-me</Cmd>, you cannot open the servers&apos; pages here.
        </Help>
      </Section>
    </>
  );
}

function Section({ id, description, failed, className, children }: { id: (typeof SECTIONS)[number]["id"]; description: string; failed?: boolean; className?: string; children: ReactNode }) {
  const title = SECTIONS.find((s) => s.id === id)!.title;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("card flex min-w-0 scroll-mt-6 flex-col gap-4", className)}>
      <div>
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {failed ? <ErrorState title="Could not load this">Try again in a minute.</ErrorState> : children}
    </section>
  );
}

function Help({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

function Cmd({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>;
}
