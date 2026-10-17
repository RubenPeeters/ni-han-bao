# CLAUDE.md

## What this repo is

ni-han-bao: a Discord bot that lives in one server, plus a public website that shows fun
statistics about that server.

```
Discord ──gateway──► bot/ (discord.js, container on the Hetzner box)
                        │ writes aggregates with the Supabase *secret* key
                        ▼
                    Supabase Postgres  ◄── reads with the *publishable* key ── Next.js site (Vercel)
```

- `bot/`: TypeScript package (`pnpm --filter ni-han-bao-bot ...`). Entry `bot/src/index.ts`.
  Deployed from `main` by a timer on the box; see `bot/deploy/`.
- Website: the Next.js app at the repo root (App Router, `cacheComponents`), deployed by
  Vercel: `main` to production, every other branch to a preview URL.
- Database: `supabase/migrations/*.sql`, applied by `.github/workflows/migrate.yml` on push
  to `dev` and `main`. Stack choices: `stack.toml`.

## Data rules (non-negotiable)

- **Never store message content.** The bot does not request the MessageContent intent; do
  not add it. Store counts, timestamps, ids and names only.
- Every table: RLS enabled, a `select` policy for `anon`, no write policies. Only the bot
  writes, with the secret key. The secret key never appears in website code.
- `dev` previews and production share **one** database. Migrations must be additive and
  backwards compatible: add tables/columns, never rename or drop in the same release.
- Migration files are named `YYYYMMDDHHMMSS_description.sql` and are never edited once merged.
- The site is public and shows member names. Anything per-member must respect the opt-out
  (once it exists): hidden members appear in no list and no chart.

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
