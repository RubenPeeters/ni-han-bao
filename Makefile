.PHONY: install check
install:
	pnpm install --frozen-lockfile
# Builds without Supabase env vars (the example shows a setup notice instead), so CI needs no secrets.
check: install
	pnpm lint
	pnpm build
	node scripts/check-public-pages.mjs
	pnpm --filter ni-han-bao-bot typecheck
	pnpm --filter ni-han-bao-bot test
