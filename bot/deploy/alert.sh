#!/usr/bin/env bash
# Post to ALERT_WEBHOOK when the bot's heartbeat goes stale or the site stops answering 200,
# and once more when it recovers. Run every 5 minutes by ni-han-bao-alert.timer.
set -uo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
# A marker file per check that is currently down, so each outage posts once, not every run.
state="${STATE_DIRECTORY:-/var/lib/ni-han-bao-alert}"
mkdir -p "$state"

# bot_status is members-only (#45); public_totals() gives anon the newest heartbeat. `since`
# only feeds the message totals, which are not read here.
cutoff=$(date -u -d '-10 min' +%Y-%m-%dT%H:%M:%SZ)
fresh=$(curl -fsS --max-time 20 \
  -H "apikey: $SUPABASE_PUBLISHABLE_KEY" -H "Authorization: Bearer $SUPABASE_PUBLISHABLE_KEY" \
  "$SUPABASE_URL/rest/v1/rpc/public_totals?since=$(date -u +%F)&select=bot_last_seen&bot_last_seen=gte.$cutoff")
# An unreadable heartbeat counts as stale: nobody can tell the bot is alive.
[ -n "$fresh" ] && [ "$fresh" != "[]" ] && bot_up=1 || bot_up=0

code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$SITE_URL")
[ "$code" = 200 ] && site_up=1 || site_up=0

# name, up (1/0), down message, recovered message
report() {
  local msg
  if [ "$2" = 0 ] && [ ! -e "$state/$1" ]; then msg=$3
  elif [ "$2" = 1 ] && [ -e "$state/$1" ]; then msg=$4
  else return 0; fi
  # The state only changes once Discord took the post, so a failed post is retried next run.
  curl -fsS --max-time 20 -H 'Content-Type: application/json' \
    -d "{\"content\":\"$msg\"}" "$ALERT_WEBHOOK" >/dev/null || return 1
  if [ "$2" = 0 ]; then touch "$state/$1"; else rm -f "$state/$1"; fi
  echo "$msg"
}
status=0
report bot "$bot_up" ":red_circle: Bot heartbeat is older than 10 minutes." \
  ":green_circle: Bot heartbeat is back." || status=1
report site "$site_up" ":red_circle: Site $SITE_URL answered $code instead of 200." \
  ":green_circle: Site $SITE_URL answers 200 again." || status=1
exit $status
