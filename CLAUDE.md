# CLAUDE.md

## What this repo is

ni-han-bao: a Discord bot that counts the servers it is in, plus a website that shows fun
statistics about them: totals across all servers to everyone, each server's pages only to
its members (log in with Discord).

```
Discord ──gateway──► bot/ (discord.js, container on the Hetzner box)
                        │ writes aggregates with the Supabase *secret* key
                        ▼
                    Supabase Postgres  ◄── reads with the *publishable* key ── Next.js site (Vercel)
```

- `bot/`: TypeScript package (`pnpm --filter ni-han-bao-bot ...`). Entry `bot/src/index.ts`.
  Deployed from `main` by a timer on the box; see `bot/deploy/`.
- Website: the Next.js app at the repo root (App Router, `cacheComponents`), deployed by
  Vercel, from `main` only (`vercel.json`): other branches get no preview deployment, which
  keeps the Hobby plan under its daily deploy limit. Check visual changes with `make screenshots`.
  Public: the home page (`public_totals()`, no names) and the server picker `/s`. Private:
  `/s/[guildId]/...`, read with the visitor's session, a 404 for non-members (`lib/guild.ts`).
- Database: `supabase/migrations/*.sql`, applied by `.github/workflows/migrate.yml` on push
  to `dev` and `main`. Stack choices: `stack.toml`.

## Data rules (non-negotiable)

- **Never store message content.** The bot does not request the MessageContent intent; do
  not add it. Store counts, timestamps, ids and names only.
- Every table: RLS enabled, a `select` policy for `anon`, no write policies. Only the bot
  writes, with the secret key. The secret key never appears in website code.
- Two databases: `dev` migrates the **dev** Supabase project, `main` migrates **production**
  (`migrate.yml`). A migration reaches production only with the release that carries the
  code using it, so a breaking change (rename, drop) is allowed when it ships together with
  its code. Production still runs the previous release until then: never assume production
  data matches `dev`.
- Per-server tables carry `guild_id`, and every new per-server table must have it. The bot
  writes it explicitly; every site query filters on the route's `guildId`, after
  `memberGuild()` (`lib/guild.ts`) has checked the visitor is a member, in every page.
- Migration files are named `YYYYMMDDHHMMSS_description.sql` and are never edited once merged.
- The site is no longer fully public, but members see each other's names. Anything
  per-member must respect the opt-out: hidden members appear in no list and no chart.
  Logged-out pages show totals only: no server names, member names or anything per person.

## Commands

- `make check`: lint + build the site, typecheck + test the bot. Must pass before pushing.
- `make screenshots`: build the site and write full-page PNGs of every page (375px and
  1280px, dark) to `.forge/screenshots/`. Pages are discovered from `app/**/page.tsx`. Look
  at them after any visible change; forge also attaches them to every review.
- Bot tests: `bot/src/*.test.ts` (vitest). Keep Discord and Supabase out of unit tests:
  put logic in pure functions and test those.

## Working agreement (forge)

- `main` is released code, `dev` is integration. Neither is pushed to directly.
- Every change is one issue -> one branch (`feat/<n>-slug`, `fix/<n>-slug`, ...) -> one PR into `dev`.
- PRs are reviewed by Codex, Gemini (Antigravity) and Muse; blocking findings must be fixed or rebutted.
- `make check` must pass before a commit is pushed. It runs exactly what CI runs.
- Keep PRs small and focused. No speculative abstractions, no drive-by refactors.
- Comments explain *why*, never *what*.
- Conventional Commit messages.

## Ask before doing

- Adding a dependency
- Changing CI, deployment, or anything under `.github/`
- Database schema changes that are not backwards compatible
- Anything needing a secret or credential
