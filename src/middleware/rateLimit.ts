import { NextFunction, Request, Response } from "express";
import { RateLimiter } from "../limiters/RateLimiter";
import { sendRateLimited, sendUnauthorized, sendUnavailable } from "../utils/respond";

/**
 * Builds a route-scoped rate-limit middleware from any RateLimiter implementation.
 * The middleware never knows or cares whether it's driving a TokenBucketLimiter,
 * a SlidingWindowCounterLimiter, or anything added later (Open/Closed principle).
 *
 * Store failures (e.g. Redis unreachable) fail closed with 503 rather than
 * silently allowing the request through — see ARCHITECTURE.md §7.2.
 */
export function rateLimitMiddleware(limiter: RateLimiter) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.client) {
      sendUnauthorized(res);
      return;
    }

    try {
      const allowed = await limiter.check(req.client.id);
      if (allowed) {
        next();
      } else {
        sendRateLimited(res);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[rateLimit] store error for client "${req.client.id}":`, err);
      sendUnavailable(res);
    }
  };
}
