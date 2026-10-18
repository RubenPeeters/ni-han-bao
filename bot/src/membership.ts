/** PostgREST's default maximum rows per response, so reads page at this size. */
export const READ_PAGE = 1000;
// Deletes put the ids in the URL; this keeps one request well under URL length limits.
export const WRITE_CHUNK = 200;

/** What to add and remove so the stored member ids become the current ones. */
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
  const stored: string[] = [];
  for (let from = 0; ; from += READ_PAGE) {
    const page = await store.storedPage(from, from + READ_PAGE - 1);
    stored.push(...page);
    if (page.length < READ_PAGE) break;
  }
  const { add, remove } = membershipDiff(stored, current);
  for (let i = 0; i < add.length; i += WRITE_CHUNK) await store.add(add.slice(i, i + WRITE_CHUNK));
  for (let i = 0; i < remove.length; i += WRITE_CHUNK) await store.remove(remove.slice(i, i + WRITE_CHUNK));
  return { added: add.length, removed: remove.length };
}
