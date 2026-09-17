/**
 * Generic state bag for a rate limiter's counters. The shape is algorithm-defined:
 * Token Bucket stores { tokens, lastRefillTs }, Sliding Window Counter stores { count }.
 */
export type StoreRecord = Record<string, number>;

/**
 * Result of an atomic update: the next value to persist (or null to leave the key
 * untouched) and the caller-facing result (typically { allowed: boolean }).
 */
export interface UpdateResult<R> {
  next: StoreRecord | null;
  ttlMs?: number;
  result: R;
}

export type UpdateFn<R> = (current: StoreRecord | null, now: number) => UpdateResult<R>;

/**
 * Abstraction over "where rate-limit counters live". Every concrete store (in-memory,
 * Redis, ...) implements this and is otherwise interchangeable — limiters depend only
 * on this interface (Dependency Inversion), never on a concrete store class.
 */
export interface RateLimitStore {
  get(key: string): Promise<StoreRecord | null>;

  /**
   * Applies `updateFn` to the current record for `key` as a single atomic unit:
   * no other caller can observe or apply an update between the read and the write.
   * This is what prevents check-then-act races (see ARCHITECTURE.md §7.1).
   */
  atomicUpdate<R>(key: string, updateFn: UpdateFn<R>): Promise<R>;
}
