import { RateLimitStore, StoreRecord, UpdateFn } from "./RateLimitStore";

interface Entry {
  record: StoreRecord;
  expiresAt: number | null;
}

/**
 * In-process Map-based store. `updateFn` is synchronous and JavaScript's event loop
 * never preempts a synchronous block, so get -> updateFn -> set inside atomicUpdate
 * cannot be interleaved by another request — no mutex is required.
 *
 * The Sliding Window Counter mints a new key per window index forever, so entries
 * must expire: lazily on read (an expired entry is treated as absent) and via a
 * periodic sweep so memory is actually reclaimed for keys nobody reads again.
 */
export class MemoryStore implements RateLimitStore {
  private readonly data = new Map<string, Entry>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(private readonly sweepIntervalMs = 60_000, private readonly now: () => number = Date.now) {
    this.sweepTimer = setInterval(() => this.sweepExpired(), this.sweepIntervalMs);
    this.sweepTimer.unref?.();
  }

  async get(key: string): Promise<StoreRecord | null> {
    return this.readLive(key);
  }

  async atomicUpdate<R>(key: string, updateFn: UpdateFn<R>): Promise<R> {
    const current = this.readLive(key);
    const { next, ttlMs, result } = updateFn(current, this.now());

    if (next !== null) {
      this.data.set(key, {
        record: next,
        expiresAt: ttlMs !== undefined ? this.now() + ttlMs : null,
      });
    }

    return result;
  }

  /** Stops the background sweep timer. Call on shutdown / after tests. */
  close(): void {
    clearInterval(this.sweepTimer);
  }

  private readLive(key: string): StoreRecord | null {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.data.delete(key);
      return null;
    }
    return entry.record;
  }

  private sweepExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.data) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this.data.delete(key);
      }
    }
  }
}
