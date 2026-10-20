import { BACKGROUND, BORDER, CARD, FOREGROUND, GOLD, MUTED } from "@/lib/og";
import { funFact, hourLabel, KEY_PATTERN, monthLabel, recapMonth, type RecapData } from "@/lib/recap";
import { createClient } from "@/lib/supabase/server";
import { hasEnvVars } from "@/lib/utils";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

const fmt = (n: number) => n.toLocaleString("en-US");
const ellipsis = { overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" } as const;

/**
 * The monthly recap card (#75), for a member's session or for the bot, which has none and
 * passes the month's key from monthly_recaps instead. Anyone else gets a 404, as on the pages.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/s/[guildId]/recap/[month]/og">) {
  const { guildId, month: segment } = await params;
  const month = recapMonth(segment);
  const key = request.nextUrl.searchParams.get("key");
  if (!hasEnvVars || !month || (key !== null && !KEY_PATTERN.test(key))) return new Response(null, { status: 404 });
  const supabase = await createClient();
  const recap = await supabase.rpc("monthly_recap", { guild: guildId, month, ...(key && { recap_key: key }) });
  if (recap.error) throw new Error(`monthly_recap failed: ${recap.error.message}`);
  const data = recap.data as RecapData | null;
  if (!data) return new Response(null, { status: 404 });
  return recapImage(month, data);
}

function recapImage(month: string, data: RecapData) {
  const tiles = [
    ["Busiest channel", data.busiest_channel ? `#${data.busiest_channel.name}` : "Tumbleweeds"],
    ["Peak hour", data.peak_hour === null ? "Never" : hourLabel(data.peak_hour)],
  ] as const;
  const emoji = data.top_emoji;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 32,
          padding: 56,
          background: BACKGROUND,
          color: FOREGROUND,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 28, color: MUTED, ...ellipsis }}>{data.server ?? "ni han bao"}</div>
          <div style={{ fontSize: 64, color: GOLD }}>{`Monthly recap: ${monthLabel(month)}`}</div>
        </div>
        <div style={{ flex: 1, display: "flex", gap: 24 }}>
          <div style={{ ...box, flex: 1 }}>
            <div style={{ fontSize: 24, color: MUTED }}>Top chatters</div>
            {data.top_talkers.length ? (
              data.top_talkers.map((t, i) => (
                <div key={t.display_name} style={{ display: "flex", gap: 16, fontSize: 34 }}>
                  <div style={{ color: MUTED }}>{`${i + 1}.`}</div>
                  <div style={{ flex: 1, ...ellipsis }}>{t.display_name}</div>
                  <div>{fmt(t.message_count)}</div>
                </div>
              ))
            ) : (
              <div style={{ fontSize: 34 }}>Nobody said a word.</div>
            )}
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 24 }}>
            {tiles.map(([label, value]) => (
              <div key={label} style={{ ...box, ...row }}>
                <div style={{ fontSize: 24, color: MUTED, flexShrink: 0 }}>{label}</div>
                <div style={{ fontSize: 34, ...ellipsis }}>{value}</div>
              </div>
            ))}
            <div style={{ ...box, ...row }}>
              <div style={{ fontSize: 24, color: MUTED, flexShrink: 0 }}>Top emoji</div>
              <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 34 }}>
                {!emoji ? (
                  "No reactions at all"
                ) : emoji.emoji_id ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Satori draws <img>, next/image does not exist here
                  <img src={`https://cdn.discordapp.com/emojis/${emoji.emoji_id}.png?size=96`} width={40} height={40} alt="" />
                ) : (
                  emoji.emoji_key
                )}
                {emoji && <div>{`${fmt(emoji.reaction_count)} times`}</div>}
              </div>
            </div>
          </div>
        </div>
        <div style={{ fontSize: 28, color: MUTED }}>{`Fun fact: ${funFact(data)}`}</div>
      </div>
    ),
    // Twemoji for the unicode emoji Satori's font lacks; private, since it shows a server's names.
    { width: 1200, height: 630, emoji: "twemoji", headers: { "cache-control": "private, no-store" } },
  );
}

const box = {
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: 12,
  padding: 24,
  borderRadius: 16,
  border: `2px solid ${BORDER}`,
  background: CARD,
} as const;

const row = { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 24 } as const;
