import { MemoryStore } from "../src/storage/MemoryStore";
import { TokenBucketLimiter } from "../src/limiters/TokenBucketLimiter";

describe("TokenBucketLimiter", () => {
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    clock = 0;
  });

  it("allows a burst up to capacity, then throttles", async () => {
    const store = new MemoryStore(60_000, now);
    const limiter = new TokenBucketLimiter(store, "tb", () => ({ capacity: 3, refillRatePerSec: 1 }));

    expect(await limiter.check("client-a")).toBe(true);
    expect(await limiter.check("client-a")).toBe(true);
    expect(await limiter.check("client-a")).toBe(true);
    // Bucket started full (capacity 3) and no time has passed, so a 4th request
    // in the same instant must be rejected.
    expect(await limiter.check("client-a")).toBe(false);

    store.close();
  });

  it("refills over time at the configured rate", async () => {
    const store = new MemoryStore(60_000, now);
    const limiter = new TokenBucketLimiter(store, "tb", () => ({ capacity: 1, refillRatePerSec: 1 }));

    expect(await limiter.check("client-a")).toBe(true);
    expect(await limiter.check("client-a")).toBe(false);

    clock += 1000; // 1 second later, refillRatePerSec=1 -> exactly 1 new token
    expect(await limiter.check("client-a")).toBe(true);
    expect(await limiter.check("client-a")).toBe(false);

    store.close();
  });

  it("keeps clients isolated from each other", async () => {
    const store = new MemoryStore(60_000, now);
    const limiter = new TokenBucketLimiter(store, "tb", (clientId) =>
      clientId === "client-a" ? { capacity: 1, refillRatePerSec: 1 } : { capacity: 5, refillRatePerSec: 1 }
    );

    expect(await limiter.check("client-a")).toBe(true);
    expect(await limiter.check("client-a")).toBe(false);

    // client-b has its own bucket/config and is unaffected by client-a's usage.
    expect(await limiter.check("client-b")).toBe(true);
    expect(await limiter.check("client-b")).toBe(true);

    store.close();
  });

  it("never allows more than `capacity` requests when fired concurrently (no check-then-act race)", async () => {
    const store = new MemoryStore(60_000, now);
    const capacity = 5;
    const limiter = new TokenBucketLimiter(store, "tb", () => ({ capacity, refillRatePerSec: 0 }));

    const results = await Promise.all(Array.from({ length: 20 }, () => limiter.check("client-a")));
    const allowedCount = results.filter(Boolean).length;

    expect(allowedCount).toBe(capacity);

    store.close();
  });
});
