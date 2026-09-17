/**
 * Abstraction every rate-limiting algorithm implements. Route handlers and the
 * rate-limit middleware depend only on this interface (Dependency Inversion),
 * so /foo and /bar can each be wired to a different concrete algorithm without
 * the middleware ever knowing which one it's talking to (Liskov Substitution).
 */
export interface RateLimiter {
  /** Resolves to true if the request for `clientId` is allowed, false if throttled. */
  check(clientId: string): Promise<boolean>;
}
