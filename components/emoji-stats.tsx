import {
  EmptyState,
  ErrorState,
  MemberRankRow,
  RankList,
  RankRow,
  StatCard,
  StatGrid,
} from "@/components/stat-ui";
import { GUILD_ID } from "@/lib/guild";
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
    supabase.rpc("top_emoji", { top: TOP, guild: GUILD_ID }),
    supabase.rpc("most_reacted_members", { top: TOP, guild: GUILD_ID }),
  ]);

  if (emoji.error || members.error) {
    return <ErrorState title="Could not load emoji stats">Try again in a minute.</ErrorState>;
  }
  return (
    <StatGrid>
      <TopEmoji rows={emoji.data} />
      <MostReacted rows={members.data} />
    </StatGrid>
  );
}

export function Emoji({ row }: { row: EmojiRow }) {
  if (!row.emoji_id) {
    return <span className="flex size-7 shrink-0 items-center justify-center text-2xl">{row.name}</span>;
  }
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
      className="size-7 shrink-0 object-contain"
    />
  );
}

function TopEmoji({ rows }: { rows: EmojiRow[] }) {
  return (
    <StatCard title="Top emoji" description="Reactions added, all time">
      {rows.length === 0 ? (
        <EmptyState>No reactions counted yet.</EmptyState>
      ) : (
        <RankList>
          {rows.map((row, i) => (
            <RankRow key={row.emoji_key} rank={i + 1} value={row.reaction_count.toLocaleString("en-US")}>
              <Emoji row={row} />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {row.emoji_id ? `:${row.name ?? "emoji"}:` : ""}
              </span>
            </RankRow>
          ))}
        </RankList>
      )}
    </StatCard>
  );
}

function MostReacted({ rows }: { rows: MemberRow[] }) {
  return (
    <StatCard title="Most reacted to" description="Reactions on their messages, all time">
      {rows.length === 0 ? (
        <EmptyState>No reactions counted yet.</EmptyState>
      ) : (
        <RankList>
          {rows.map((row, i) => (
            <MemberRankRow
              key={row.user_id}
              rank={i + 1}
              name={row.display_name}
              avatarUrl={row.avatar_url}
              value={row.reaction_count.toLocaleString("en-US")}
            />
          ))}
        </RankList>
      )}
    </StatCard>
  );
}
