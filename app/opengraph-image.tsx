import type { Totals } from "@/components/bot-status";
import { utcWeekStart } from "@/components/leaderboard";
import { BACKGROUND, BORDER, CARD, FOREGROUND, GOLD, MUTED } from "@/lib/og";
import { hasEnvVars } from "@/lib/utils";
import { createClient } from "@supabase/supabase-js";
import { cacheLife } from "next/cache";
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The link preview for every page: unfurlers fetch it logged out, so it shows the public
// totals only, never a server, a member or a per-server number (#55).
export const alt = "nexus: totals across every server it counts";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const fmt = (n: number) => n.toLocaleString("en-US");

// Every unfurl would otherwise query Supabase; the totals are the same for everyone.
async function loadTotals(): Promise<Totals | null> {
  "use cache";
  cacheLife("hours");
  if (!hasEnvVars) return null;
  // No cookies: an unfurler has no session, and the image must not depend on whose it is.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data } = await supabase
    .rpc("public_totals", { since: utcWeekStart(new Date()) })
    .single<Totals>();
  return data;
}

export default async function Image() {
  const totals = await loadTotals();
  // Satori needs the bytes, not a path; the same file is the site icon.
  const icon = `data:image/png;base64,${(await readFile(join(process.cwd(), "app/icon.png"))).toString("base64")}`;
  const stats = totals && [
    ["Servers", totals.servers],
    ["Members", totals.members],
    ["Messages this week", totals.messages_since],
    ["Active this week", totals.active_since],
  ] as const;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 48,
          padding: 60,
          background: BACKGROUND,
          color: FOREGROUND,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws <img>, next/image does not exist here */}
            <img src={icon} width={112} height={112} style={{ borderRadius: 56 }} alt="" />
            <div style={{ fontSize: 96, color: GOLD }}>nexus</div>
          </div>
          <div style={{ fontSize: 36, color: MUTED }}>
            Quietly counting every message, so you can argue about who talks too much.
          </div>
        </div>
        {stats && (
          <div style={{ display: "flex", gap: 16 }}>
            {stats.map(([label, value]) => (
              <div
                key={label}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: 20,
                  borderRadius: 16,
                  border: `2px solid ${BORDER}`,
                  background: CARD,
                }}
              >
                <div style={{ fontSize: 22, color: MUTED }}>{label}</div>
                <div style={{ fontSize: 40 }}>{fmt(value)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    ),
    size,
  );
}
