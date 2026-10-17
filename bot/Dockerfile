# Build from the repo root: docker build -f bot/Dockerfile .
# Only the bot's dependencies are installed; the website is not part of this image.
FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY bot/package.json bot/
RUN pnpm install --frozen-lockfile --filter ni-han-bao-bot
COPY bot bot
RUN pnpm --filter ni-han-bao-bot build
USER node
CMD ["node", "bot/dist/index.js"]
