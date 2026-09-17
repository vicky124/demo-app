import type { Redis } from "ioredis";
import { RateLimitStore, StoreRecord, UpdateFn } from "./RateLimitStore";

const MAX_RETRIES = 30;
const BASE_BACKOFF_MS = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Redis-backed store. Atomicity is implemented with Redis's WATCH/MULTI/EXEC
 * optimistic-concurrency-control pattern: watch the key, read it, compute the
 * update in JS, then commit the write transactionally. If another writer touched
 * the key in between, EXEC returns null and we retry. This executes the exact
 * same `updateFn` as MemoryStore (no per-algorithm Lua duplication needed),
 * which keeps both stores behaviorally identical and lets limiters stay fully
 * storage-agnostic.
 *
 * WATCH/MULTI/EXEC state is scoped to a single Redis *connection*, not to a
 * logical transaction — issuing two concurrent CAS attempts over one shared
 * connection lets their watched-key state interleave and silently defeats the
 * optimistic lock (verified empirically: without this, concurrent requests
 * over-counted instead of being capped). Each `atomicUpdate` attempt therefore
 * runs on its own connection via `client.duplicate()`, released when the
 * attempt finishes. This costs a connection setup per attempt (acceptable for
 * this demo's traffic); a production deployment under heavy load would use a
 * small pool of dedicated transaction connections instead of duplicating per
 * call.
 *
 * State survives process restarts and is shared across app instances, since it
 * lives in Redis rather than in process memory.
 */
export class RedisStore implements RateLimitStore {
  constructor(private readonly client: Redis, private readonly now: () => number = Date.now) {
    // Each retry duplicates a connection (see class doc); under many concurrent
    // callers this legitimately creates more listeners than EventEmitter's
    // default cap of 10, which is expected here, not a leak.
    this.client.setMaxListeners(0);
  }

  async get(key: string): Promise<StoreRecord | null> {
    const raw = await this.client.get(key);
    return raw ? (JSON.parse(raw) as StoreRecord) : null;
  }

  async atomicUpdate<R>(key: string, updateFn: UpdateFn<R>): Promise<R> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const conn = this.client.duplicate();
      try {
        await conn.watch(key);

        const raw = await conn.get(key);
        const current = raw ? (JSON.parse(raw) as StoreRecord) : null;
        const { next, ttlMs, result } = updateFn(current, this.now());

        if (next === null) {
          await conn.unwatch();
          return result;
        }

        const tx = conn.multi();
        if (ttlMs !== undefined) {
          tx.set(key, JSON.stringify(next), "PX", Math.max(1, Math.ceil(ttlMs)));
        } else {
          tx.set(key, JSON.stringify(next));
        }

        const execResult = await tx.exec();
        if (execResult !== null) {
          return result;
        }
        // execResult === null means the watched key changed concurrently; retry.
      } finally {
        conn.disconnect();
      }

      // Jittered backoff spreads out retries under contention instead of every
      // loser immediately re-colliding with the other retriers.
      await sleep(Math.random() * BASE_BACKOFF_MS * (attempt + 1));
    }

    throw new Error(`RedisStore.atomicUpdate: exceeded ${MAX_RETRIES} retries for key "${key}"`);
  }

  /** Closes the underlying Redis connection. Call on shutdown / after tests. */
  async close(): Promise<void> {
    await this.client.quit();
  }
}
