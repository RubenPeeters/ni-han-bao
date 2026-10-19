/** PostgREST's default maximum rows per response, so reads page at this size. */
export const READ_PAGE = 1000;
// Deletes put the ids in the URL; this keeps one request well under URL length limits.
export const WRITE_CHUNK = 200;

/** What to add and remove so the stored member ids become the current ones. */
/** Every row of a read, `page(from, to)` returning rows `from`..`to` inclusive in a stable order. */
export async function readAll<T>(page: (from: number, to: number) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += READ_PAGE) {
    const batch = await page(from, from + READ_PAGE - 1);
    rows.push(...batch);
    if (batch.length < READ_PAGE) return rows;
  }
}

export function membershipDiff(
  stored: Iterable<string>,
  current: Iterable<string>,
): { add: string[]; remove: string[] } {
  const was = new Set(stored);
  const now = new Set(current);
  return {
    add: [...now].filter((id) => !was.has(id)),
    remove: [...was].filter((id) => !now.has(id)),
  };
}

export interface MembershipStore {
  /** Stored member ids of the server, rows `from`..`to` inclusive in a stable order. */
  storedPage(from: number, to: number): Promise<string[]>;
  add(userIds: string[]): Promise<void>;
  remove(userIds: string[]): Promise<void>;
}

/** Brings one server's stored members in line with `current`; a failed write rejects. */
export async function syncMembers(
  current: Iterable<string>,
  store: MembershipStore,
): Promise<{ added: number; removed: number }> {
  const stored = await readAll((from, to) => store.storedPage(from, to));
  const { add, remove } = membershipDiff(stored, current);
  for (let i = 0; i < add.length; i += WRITE_CHUNK) await store.add(add.slice(i, i + WRITE_CHUNK));
  for (let i = 0; i < remove.length; i += WRITE_CHUNK) await store.remove(remove.slice(i, i + WRITE_CHUNK));
  return { added: add.length, removed: remove.length };
}

/**
 * Runs tasks one at a time per key, in call order. A full sync snapshots Discord's member
 * list and then writes; a join or leave written in between would be undone by the stale
 * snapshot, so every membership write for a server goes through one queue.
 */
export function keyedQueue(): <T>(key: string, task: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>();
  return (key, task) => {
    const run = (tails.get(key) ?? Promise.resolve()).then(task);
    const tail = run.catch(() => {});
    tails.set(key, tail);
    void tail.then(() => tails.get(key) === tail && tails.delete(key));
    return run;
  };
}

/** Tries of a full member fetch before the sync gives up until the next restart. */
export const MEMBER_FETCH_TRIES = 5;

/**
 * How long to wait before retrying a full member fetch that failed on its `attempt`-th try,
 * or null to give up. Only Discord's gateway rate limit (opcode 8) is retried: it says when
 * to come back, and each further try waits twice as long in case others share the limit.
 */
export function memberFetchRetryMs(err: unknown, attempt: number, tries = MEMBER_FETCH_TRIES): number | null {
  if (attempt >= tries) return null;
  // Matched by shape: GatewayRateLimitError lives in @discordjs/util, not a direct dependency.
  const e = err as { name?: unknown; data?: { retry_after?: unknown } } | null;
  const retryAfter = e?.data?.retry_after;
  if (e?.name !== "GatewayRateLimitError" || typeof retryAfter !== "number") return null;
  return Math.ceil(retryAfter * 1000) * 2 ** (attempt - 1);
}
