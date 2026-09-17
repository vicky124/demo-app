import { RateLimiter } from "./RateLimiter";
import { RateLimitStore } from "../storage/RateLimitStore";

export interface SlidingWindowConfig {
  /** Maximum requests allowed per window. */
  limit: number;
  windowSizeMs: number;
}

interface WindowState {
  count: number;
}

/**
 * Sliding Window Counter: estimates the request rate across the boundary between
 * the previous and current fixed window, weighted by how far into the current
 * window "now" is. Smooths the burst-at-boundary problem of a naive fixed window
 * without storing every request timestamp. Used for /bar (ARCHITECTURE.md §6.2).
 *
 * Unlike TokenBucketLimiter, this algorithm needs the same `now` value at two
 * separate store calls (reading the previous window, then atomically updating the
 * current one) to pick consistent keys and weights, so the clock is injected here
 * directly rather than sourced from the store — that's what makes it deterministic
 * under a fake clock in tests.
 *
 * Reading the previous window's key with a plain (non-atomic) `get` is safe: once
 * `windowIndex` moves past a window, that window's key is never written again, so
 * there is no concurrent writer to race with the read.
 */
export class SlidingWindowCounterLimiter implements RateLimiter {
  constructor(
    private readonly store: RateLimitStore,
    private readonly keyPrefix: string,
    private readonly configFor: (clientId: string) => SlidingWindowConfig,
    private readonly now: () => number = Date.now
  ) {}

  async check(clientId: string): Promise<boolean> {
    const { limit, windowSizeMs } = this.configFor(clientId);
    const now = this.now();
    const windowIndex = Math.floor(now / windowSizeMs);
    const elapsedInWindow = now % windowSizeMs;

    const currentKey = `${this.keyPrefix}:${clientId}:${windowIndex}`;
    const previousKey = `${this.keyPrefix}:${clientId}:${windowIndex - 1}`;

    const previous = await this.store.get(previousKey);
    const previousCount = (previous as unknown as WindowState | null)?.count ?? 0;
    const weight = (windowSizeMs - elapsedInWindow) / windowSizeMs;

    return this.store.atomicUpdate<boolean>(currentKey, (current) => {
      const currentCount = (current as unknown as WindowState | null)?.count ?? 0;
      const estimated = previousCount * weight + currentCount;

      if (estimated < limit) {
        return {
          next: { count: currentCount + 1 },
          ttlMs: windowSizeMs * 2,
          result: true,
        };
      }

      return { next: null, result: false };
    });
  }
}
