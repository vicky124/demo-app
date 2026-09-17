import { RateLimiter } from "./RateLimiter";
import { RateLimitStore } from "../storage/RateLimitStore";

export interface TokenBucketConfig {
  /** Maximum number of tokens the bucket can hold (max burst size). */
  capacity: number;
  /** Sustained refill rate, in tokens per second. */
  refillRatePerSec: number;
}

interface TokenBucketState {
  tokens: number;
  lastRefillTs: number;
}

/**
 * Token Bucket: allows short bursts up to `capacity`, then throttles to a steady
 * average of `refillRatePerSec`. Used for /foo (ARCHITECTURE.md §6.1).
 *
 * The refill + consume decision happens inside a single `store.atomicUpdate` call
 * so the check ("is there a token?") and the act (decrementing it) can never be
 * split by a concurrent request — see ARCHITECTURE.md §7.1 for why that matters.
 *
 * `now` is supplied by the store (passed into the update function), not by this
 * class, so unit tests get a deterministic clock by injecting a fake `now` into
 * the `RateLimitStore` instance rather than into the limiter — one injection
 * point shared by every algorithm running against that store.
 */
export class TokenBucketLimiter implements RateLimiter {
  constructor(
    private readonly store: RateLimitStore,
    private readonly keyPrefix: string,
    private readonly configFor: (clientId: string) => TokenBucketConfig
  ) {}

  async check(clientId: string): Promise<boolean> {
    const { capacity, refillRatePerSec } = this.configFor(clientId);
    const key = `${this.keyPrefix}:${clientId}`;
    const refillRatePerMs = refillRatePerSec / 1000;

    return this.store.atomicUpdate<boolean>(key, (current, now) => {
      const state: TokenBucketState = (current as unknown as TokenBucketState) ?? {
        tokens: capacity,
        lastRefillTs: now,
      };

      const elapsed = Math.max(0, now - state.lastRefillTs);
      const refilledTokens = Math.min(capacity, state.tokens + elapsed * refillRatePerMs);

      if (refilledTokens >= 1) {
        return {
          next: { tokens: refilledTokens - 1, lastRefillTs: now },
          result: true,
        };
      }

      return {
        next: { tokens: refilledTokens, lastRefillTs: now },
        result: false,
      };
    });
  }
}
