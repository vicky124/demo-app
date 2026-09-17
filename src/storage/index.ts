import Redis from "ioredis";
import { RateLimitStore } from "./RateLimitStore";
import { MemoryStore } from "./MemoryStore";
import { RedisStore } from "./RedisStore";

export type StorageDriver = "memory" | "redis";

// AggregateError (thrown when both IPv4/IPv6 connection attempts fail) often
// carries an empty top-level .message; its .errors array has the actual
// per-attempt reasons (e.g. ECONNREFUSED), so fall back to that.
function describeError(err: Error): string {
  if (err.message) return err.message;
  const errors = (err as { errors?: unknown }).errors;
  if (Array.isArray(errors)) {
    return errors.map((e) => (e instanceof Error ? e.message : String(e))).join("; ");
  }
  return String(err);
}

/** Selects and constructs the configured storage backend. No route/limiter code changes across drivers. */
export function createStore(driver: StorageDriver, redisUrl?: string): RateLimitStore {
  if (driver === "memory") {
    return new MemoryStore();
  }

  if (driver === "redis") {
    if (!redisUrl) {
      throw new Error("REDIS_URL must be set when STORAGE_DRIVER=redis");
    }
    const client = new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: 1 });
    // ioredis emits its own noisy "[ioredis] Unhandled error event" console
    // spam on every failed connection/retry when nothing is listening for
    // 'error'. Registering a listener silences that and lets the app log
    // once per failure; individual command failures (e.g. inside
    // RedisStore.atomicUpdate) still reject their own promise and are
    // handled by the fail-closed 503 path in middleware/rateLimit.ts
    // (ARCHITECTURE.md §7.2) regardless of this listener.
    client.on("error", (err) => {
      console.error(`[storage] Redis connection error (is Redis running at ${redisUrl}?): ${describeError(err)}`);
    });
    return new RedisStore(client);
  }

  throw new Error(`Unknown STORAGE_DRIVER: "${driver}". Expected "memory" or "redis".`);
}

export { MemoryStore, RedisStore };
export * from "./RateLimitStore";
