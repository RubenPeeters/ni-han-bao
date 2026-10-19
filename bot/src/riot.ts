// shortcut: the development key's limits, hardcoded; read X-App-Rate-Limit instead once a
// production key raises them.
export const RATE_LIMITS = [
  { count: 20, ms: 1_000 },
  { count: 100, ms: 120_000 },
] as const;

const MAX_RETRIES = 3;
const TIMEOUT_MS = 10_000;

/** Ms to wait before another request fits every limit, given the send times so far (oldest first). */
export function waitMs(sent: readonly number[], now: number, limits: readonly { count: number; ms: number }[] = RATE_LIMITS): number {
  let wait = 0;
  for (const { count, ms } of limits) {
    const recent = sent.filter((t) => t > now - ms);
    // The request `count` back from the newest has to leave the window first.
    if (recent.length >= count) wait = Math.max(wait, recent[recent.length - count] + ms - now);
  }
  return wait;
}

/** A 429's Retry-After (seconds) in ms; Riot omits it when the service, not the key, is busy. */
export function retryAfterMs(header: string | null): number {
  const seconds = Number(header);
  return header && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : 10_000;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The Riot API with one key (Riot policy: one key, this product only). Requests go one at a
 * time through a queue that keeps under the rate limits, and a 429 holds the whole queue for
 * its Retry-After.
 */
export class RiotApi {
  private sent: number[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly key: string,
    private readonly fetchFn: Fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** GET `https://{host}.api.riotgames.com{path}`; null on 404. */
  get<T>(host: string, path: string): Promise<T | null> {
    const run = this.queue.then(() => this.send<T>(`https://${host}.api.riotgames.com${path}`));
    this.queue = run.catch(() => {});
    return run;
  }

  private async send<T>(url: string): Promise<T | null> {
    for (let attempt = 0; ; attempt++) {
      const wait = waitMs(this.sent, this.now());
      if (wait > 0) await this.sleep(wait);
      const longest = Math.max(...RATE_LIMITS.map((l) => l.ms));
      this.sent = [...this.sent.filter((t) => t > this.now() - longest), this.now()];
      const res = await this.fetchFn(url, { headers: { "X-Riot-Token": this.key }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status === 429 && attempt < MAX_RETRIES) {
        await this.sleep(retryAfterMs(res.headers.get("retry-after")));
        continue;
      }
      if (res.status === 404) return null;
      // The URL holds the Riot ID; the status is enough to debug.
      if (!res.ok) throw new Error(`riot api: ${res.status}`);
      return (await res.json()) as T;
    }
  }
}
