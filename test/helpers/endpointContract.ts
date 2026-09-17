import request from "supertest";
import { Express } from "express";
import { createApp } from "../../src/app";
import { RateLimitStore } from "../../src/storage/RateLimitStore";

/**
 * Runs the full endpoint contract against any RateLimitStore. Invoked once per
 * storage backend (memory, Redis) so both are proven to satisfy the identical
 * HTTP contract — ARCHITECTURE.md R10/R11.
 */
export function describeEndpointContract(
  storeName: string,
  makeStore: () => RateLimitStore,
  closeStore?: (s: RateLimitStore) => void | Promise<void>
) {
  describe(`GET /foo and /bar (storage: ${storeName})`, () => {
    let app: Express;
    let store: RateLimitStore;

    beforeEach(() => {
      store = makeStore();
      app = createApp(store);
    });

    afterEach(async () => {
      await closeStore?.(store);
    });

    it("rejects requests with no Authorization header", async () => {
      const res = await request(app).get("/foo");
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "unauthorized" });
    });

    it("rejects requests with an unknown client id", async () => {
      const res = await request(app).get("/foo").set("Authorization", "bearer nobody");
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "unauthorized" });
    });

    it("rejects a malformed Authorization scheme", async () => {
      const res = await request(app).get("/foo").set("Authorization", "token client-a");
      expect(res.status).toBe(401);
    });

    it("GET /foo returns 200 then 429 once client-b's low token-bucket capacity is exceeded", async () => {
      // client-b: capacity 3, refillRatePerSec 0.2 (config/clients.json)
      for (let i = 0; i < 3; i++) {
        const res = await request(app).get("/foo").set("Authorization", "bearer client-b");
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true });
      }

      const res = await request(app).get("/foo").set("Authorization", "bearer client-b");
      expect(res.status).toBe(429);
      expect(res.body).toEqual({ error: "rate limit exceeded" });
    });

    it("GET /bar returns 200 then 429 once client-a's sliding-window limit is exceeded", async () => {
      // client-a: limit 5, windowSizeMs 10000 (config/clients.json)
      for (let i = 0; i < 5; i++) {
        const res = await request(app).get("/bar").set("Authorization", "bearer client-a");
        expect(res.status).toBe(200);
      }

      const res = await request(app).get("/bar").set("Authorization", "bearer client-a");
      expect(res.status).toBe(429);
      expect(res.body).toEqual({ error: "rate limit exceeded" });
    });

    it("keeps client-a and client-b's usage fully independent on the same endpoint", async () => {
      for (let i = 0; i < 3; i++) {
        await request(app).get("/foo").set("Authorization", "bearer client-b");
      }
      const exhausted = await request(app).get("/foo").set("Authorization", "bearer client-b");
      expect(exhausted.status).toBe(429);

      // client-a has a separate, much larger /foo bucket (capacity 10) and is unaffected.
      const stillAllowed = await request(app).get("/foo").set("Authorization", "bearer client-a");
      expect(stillAllowed.status).toBe(200);
    });

    it("/foo and /bar track independent limits for the same client", async () => {
      for (let i = 0; i < 3; i++) {
        await request(app).get("/foo").set("Authorization", "bearer client-b");
      }
      const fooExhausted = await request(app).get("/foo").set("Authorization", "bearer client-b");
      expect(fooExhausted.status).toBe(429);

      // /bar for client-b (limit 20) is untouched by /foo usage.
      const barStillAllowed = await request(app).get("/bar").set("Authorization", "bearer client-b");
      expect(barStillAllowed.status).toBe(200);
    });
  });
}
