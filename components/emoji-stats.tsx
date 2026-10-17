import { createClient } from "@/lib/supabase/server";

const TOP = 10;

export interface EmojiRow {
  emoji_key: string;
  emoji_id: string | null;
  name: string | null;
  animated: boolean;
  reaction_count: number;
}

interface MemberRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  reaction_count: number;
}

export async function EmojiStats() {
  const supabase = await createClient();
  const [emoji, members] = await Promise.all([
    supabase.rpc("top_emoji", { top: TOP }),
    supabase.rpc("most_reacted_members", { top: TOP }),
  ]);

  if (emoji.error || members.error) {
    return <p className="text-sm text-destructive">Could not load emoji stats.</p>;
  }
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <TopEmoji rows={emoji.data} />
      <MostReacted rows={members.data} />
    </div>
  );
}

export function Emoji({ row }: { row: EmojiRow }) {
  if (!row.emoji_id) return <span className="text-2xl leading-7">{row.name}</span>;
  const label = `:${row.name ?? "emoji"}:`;
  return (
    // Discord CDN images are already small; next/image would need a remote pattern and
    // optimisation quota for no visible gain.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://cdn.discordapp.com/emojis/${row.emoji_id}.${row.animated ? "gif" : "png"}?size=56`}
      alt={label}
      title={label}
      width={28}
      height={28}
      className="size-7 object-contain"
    />
  );
}

function TopEmoji({ rows }: { rows: EmojiRow[] }) {
  return (
    <section className="card flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Top emoji</h2>
        <p className="text-xs text-muted-foreground">Reactions added, all time</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reactions counted yet.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <li key={row.emoji_key} className="flex items-center gap-3 text-sm">
              <span className="w-5 text-right text-muted-foreground">{i + 1}</span>
              <Emoji row={row} />
              <span className="flex-1 truncate text-muted-foreground">
                {row.emoji_id ? `:${row.name ?? "emoji"}:` : ""}
              </span>
              <span className="tabular-nums">{row.reaction_count.toLocaleString("en-US")}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function MostReacted({ rows }: { rows: MemberRow[] }) {
  return (
    <section className="card flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Most reacted to</h2>
        <p className="text-xs text-muted-foreground">Reactions on their messages, all time</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reactions counted yet.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <li key={row.user_id} className="flex items-center gap-3 text-sm">
              <span className="w-5 text-right text-muted-foreground">{i + 1}</span>
              {row.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.avatar_url} alt="" width={28} height={28} className="rounded-full" />
              ) : (
                <span className="size-7 rounded-full bg-foreground/10" />
              )}
              <span className="flex-1 truncate">{row.display_name}</span>
              <span className="tabular-nums">{row.reaction_count.toLocaleString("en-US")}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
