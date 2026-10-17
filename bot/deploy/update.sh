#!/usr/bin/env bash
# Deploy whatever is on origin/main. Run every 5 minutes by ni-han-bao-update.timer.
# The clone is read-only (deploy key), so the box pulls; nothing outside can push to it.
set -euo pipefail
cd /opt/ni-han-bao
git fetch -q origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ] || ! docker compose -f bot/deploy/compose.yaml ps --status running -q | grep -q .; then
  git reset -q --hard origin/main
  docker compose -f bot/deploy/compose.yaml up -d --build
  echo "deployed $(git rev-parse --short HEAD)"
fi
