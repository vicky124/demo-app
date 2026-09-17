import RedisMock from "ioredis-mock";
import type { Redis } from "ioredis";
import { RedisStore } from "../src/storage/RedisStore";
import { TokenBucketLimiter } from "../src/limiters/TokenBucketLimiter";

describe("RedisStore", () => {
  it("round-trips a record written by atomicUpdate through get", async () => {
    const store = new RedisStore(new RedisMock() as unknown as Redis);

    await store.atomicUpdate("k", () => ({ next: { count: 1 }, result: undefined }));
    const record = await store.get("k");

    expect(record).toEqual({ count: 1 });
    await store.close();
  });

  it("expires a record after its TTL", async () => {
    let clock = 0;
    const store = new RedisStore(new RedisMock() as unknown as Redis, () => clock);

    await store.atomicUpdate("k", () => ({ next: { count: 1 }, ttlMs: 50, result: undefined }));
    expect(await store.get("k")).toEqual({ count: 1 });

    // ioredis-mock honors real wall-clock TTL regardless of our injected `now`,
    // so wait past the TTL for real.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await store.get("k")).toBeNull();

    await store.close();
  });

  it("drives TokenBucketLimiter correctly, including concurrent requests capped at capacity", async () => {
    const store = new RedisStore(new RedisMock() as unknown as Redis);
    const capacity = 5;
    const limiter = new TokenBucketLimiter(store, "tb", () => ({ capacity, refillRatePerSec: 0 }));

    const results = await Promise.all(Array.from({ length: 15 }, () => limiter.check("client-a")));
    const allowedCount = results.filter(Boolean).length;

    expect(allowedCount).toBe(capacity);
    await store.close();
  });
});
