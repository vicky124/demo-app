import express, { Express } from "express";
import { RateLimitStore } from "./storage/RateLimitStore";
import { TokenBucketLimiter } from "./limiters/TokenBucketLimiter";
import { SlidingWindowCounterLimiter } from "./limiters/SlidingWindowCounterLimiter";
import { authMiddleware } from "./middleware/auth";
import { rateLimitMiddleware } from "./middleware/rateLimit";
import { sendSuccess } from "./utils/respond";
import { getClientLimits } from "./config/clients";

function requireLimits(clientId: string) {
  const limits = getClientLimits(clientId);
  if (!limits) {
    // authMiddleware already rejects unknown clients with 401 before this can
    // run, so reaching here means the client registry changed underneath a
    // live request — a programming error, not a normal user-facing case.
    throw new Error(`No limits configured for client "${clientId}"`);
  }
  return limits;
}

/**
 * Wires the app from a given store. Kept separate from index.ts (the process
 * entrypoint) so tests can build the app against any RateLimitStore — a real
 * MemoryStore, a RedisStore backed by ioredis-mock, or a hand-rolled fake —
 * without starting a real HTTP server or a real Redis instance.
 */
export function createApp(store: RateLimitStore): Express {
  const app = express();

  const fooLimiter = new TokenBucketLimiter(
    store,
    "ratelimit:token-bucket",
    (clientId) => requireLimits(clientId).foo
  );

  const barLimiter = new SlidingWindowCounterLimiter(
    store,
    "ratelimit:sliding-window",
    (clientId) => requireLimits(clientId).bar
  );

  app.get("/foo", authMiddleware, rateLimitMiddleware(fooLimiter), (_req, res) => {
    sendSuccess(res);
  });

  app.get("/bar", authMiddleware, rateLimitMiddleware(barLimiter), (_req, res) => {
    sendSuccess(res);
  });

  return app;
}
