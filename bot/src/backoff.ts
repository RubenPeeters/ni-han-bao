/** Exponential backoff between retries: base, 2x base, 4x base, ... capped at max. */
export class Backoff {
  failures = 0;
  private nextAt = 0;

  constructor(
    private readonly baseMs: number,
    private readonly maxMs: number,
  ) {}

  ready(now: number): boolean {
    return now >= this.nextAt;
  }

  /** Record a failure and return how long to wait before the next attempt. */
  fail(now: number): number {
    const delay = Math.min(this.maxMs, this.baseMs * 2 ** this.failures);
    this.failures++;
    this.nextAt = now + delay;
    return delay;
  }

  succeed(): void {
    this.failures = 0;
    this.nextAt = 0;
  }
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/**
 * Retry `flush` (which reports whether everything was written) with backoff until it
 * succeeds or the next attempt would start after `deadline`. Used on shutdown, where
 * Docker kills the process a fixed time after SIGTERM. Returns false if data is left.
 */
export async function flushUntil(
  flush: () => Promise<boolean>,
  deadline: number,
  backoff: Backoff,
  clock: Clock,
  onRetry: (attempt: number, delayMs: number) => void = () => {},
): Promise<boolean> {
  for (;;) {
    if (await flush()) {
      backoff.succeed();
      return true;
    }
    const delay = backoff.fail(clock.now());
    if (clock.now() + delay > deadline) return false;
    onRetry(backoff.failures, delay);
    await clock.sleep(delay);
  }
}

/** Work already started (a flush, a handler mid-lookup) that shutdown must wait for. */
export class InFlight {
  private readonly running = new Set<Promise<unknown>>();

  track<T>(work: Promise<T>): Promise<T> {
    this.running.add(work);
    const done = () => this.running.delete(work);
    work.then(done, done);
    return work;
  }

  /** Resolves once nothing is running, including work started while waiting. */
  async settle(): Promise<void> {
    while (this.running.size) await Promise.allSettled([...this.running]);
  }
}
