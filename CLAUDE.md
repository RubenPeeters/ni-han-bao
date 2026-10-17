# CLAUDE.md

## What this repo is

ni-han-bao. Stack: see `stack.toml` (template `webapp-vercel`).

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
