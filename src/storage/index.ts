import Redis from "ioredis";
import { RateLimitStore } from "./RateLimitStore";
import { MemoryStore } from "./MemoryStore";
import { RedisStore } from "./RedisStore";

export type StorageDriver = "memory" | "redis";

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
    return new RedisStore(client);
  }

  throw new Error(`Unknown STORAGE_DRIVER: "${driver}". Expected "memory" or "redis".`);
}

export { MemoryStore, RedisStore };
export * from "./RateLimitStore";
