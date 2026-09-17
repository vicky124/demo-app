import { MemoryStore } from "../src/storage/MemoryStore";
import { SlidingWindowCounterLimiter } from "../src/limiters/SlidingWindowCounterLimiter";

describe("SlidingWindowCounterLimiter", () => {
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    clock = 0;
  });

  it("allows up to `limit` requests within a window, then throttles", async () => {
    const store = new MemoryStore(60_000);
    const limiter = new SlidingWindowCounterLimiter(store, "sw", () => ({ limit: 3, windowSizeMs: 10_000 }), now);

    expect(await limiter.check("client-a")).toBe(true);
    expect(await limiter.check("client-a")).toBe(true);
    expect(await limiter.check("client-a")).toBe(true);
    expect(await limiter.check("client-a")).toBe(false);

    store.close();
  });

  it("smooths the boundary instead of resetting fully at the window edge", async () => {
    const store = new MemoryStore(60_000);
    const limiter = new SlidingWindowCounterLimiter(store, "sw", () => ({ limit: 4, windowSizeMs: 10_000 }), now);

    // Use up the full limit right at the very end of window 0.
    clock = 9_900;
    expect(await limiter.check("client-a")).toBe(true);
    expect(await limiter.check("client-a")).toBe(true);
    expect(await limiter.check("client-a")).toBe(true);
    expect(await limiter.check("client-a")).toBe(true);
    expect(await limiter.check("client-a")).toBe(false);

    // 100ms later we're just inside window 1. A naive fixed window would reset
    // the counter to 0 here and allow a fresh burst of 4. The sliding window
    // instead carries over most of window 0's count, weighted by how little of
    // window 1 has elapsed (previousCount=4 * weight=0.99 ≈ 3.96), so only one
    // more request fits before the estimate reaches the limit again.
    clock = 10_100;
    expect(await limiter.check("client-a")).toBe(true);
    expect(await limiter.check("client-a")).toBe(false);

    store.close();
  });

  it("fully resets once well clear of the previous window", async () => {
    const store = new MemoryStore(60_000);
    const limiter = new SlidingWindowCounterLimiter(store, "sw", () => ({ limit: 2, windowSizeMs: 10_000 }), now);

    expect(await limiter.check("client-a")).toBe(true);
    expect(await limiter.check("client-a")).toBe(true);
    expect(await limiter.check("client-a")).toBe(false);

    clock = 25_000; // two full windows later: previous window's weight is ~0
    expect(await limiter.check("client-a")).toBe(true);
    expect(await limiter.check("client-a")).toBe(true);
    expect(await limiter.check("client-a")).toBe(false);

    store.close();
  });

  it("keeps clients isolated from each other", async () => {
    const store = new MemoryStore(60_000);
    const limiter = new SlidingWindowCounterLimiter(store, "sw", () => ({ limit: 1, windowSizeMs: 10_000 }), now);

    expect(await limiter.check("client-a")).toBe(true);
    expect(await limiter.check("client-a")).toBe(false);
    expect(await limiter.check("client-b")).toBe(true);

    store.close();
  });

  it("never allows more than `limit` requests when fired concurrently within a window", async () => {
    const store = new MemoryStore(60_000);
    const limit = 5;
    const limiter = new SlidingWindowCounterLimiter(store, "sw", () => ({ limit, windowSizeMs: 10_000 }), now);

    const results = await Promise.all(Array.from({ length: 20 }, () => limiter.check("client-a")));
    const allowedCount = results.filter(Boolean).length;

    expect(allowedCount).toBe(limit);

    store.close();
  });
});
