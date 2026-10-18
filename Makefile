.PHONY: install check screenshots
install:
	pnpm install --frozen-lockfile
# Builds without Supabase env vars (the example shows a setup notice instead), so CI needs no secrets.
check: install
	pnpm lint
	node scripts/check-design-tokens.mjs
	pnpm build
	node scripts/check-public-pages.mjs
	node --test lib/*.test.mjs
	pnpm --filter ni-han-bao-bot typecheck
	pnpm --filter ni-han-bao-bot test

# Full-page PNGs of every page at 375px and 1280px, dark theme, into .forge/screenshots/.
# Used by forge for visual review; also handy locally (needs a Chromium: CHROME_PATH).
screenshots: install
	pnpm build
	node scripts/screenshots.mjs
