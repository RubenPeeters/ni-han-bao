import Image from "next/image";
import { createClient } from "@/lib/supabase/server";

type View = "leaderboard_this_week" | "leaderboard_all_time";

interface Row {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  message_count: number;
}

export async function Leaderboard({ view, title }: { view: View; title: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(view)
    .select("user_id, display_name, avatar_url, message_count")
    .order("message_count", { ascending: false })
    .order("user_id")
    .limit(10)
    .returns<Row[]>();

  return (
    <section className="rounded-lg border p-5 flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {error ? (
        <p className="text-sm text-red-600">Could not load the leaderboard.</p>
      ) : !data?.length ? (
        <p className="text-sm text-foreground/60">No messages counted yet.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {data.map((row, i) => (
            <li key={row.user_id} className="flex items-center gap-3">
              <span className="w-6 text-right text-sm text-foreground/60">{i + 1}</span>
              {row.avatar_url ? (
                <Image
                  src={row.avatar_url}
                  alt=""
                  width={32}
                  height={32}
                  className="rounded-full"
                />
              ) : (
                <span className="w-8 h-8 rounded-full bg-foreground/10" />
              )}
              <span className="flex-1 truncate">{row.display_name}</span>
              <span className="text-sm tabular-nums">{row.message_count.toLocaleString("en")}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
