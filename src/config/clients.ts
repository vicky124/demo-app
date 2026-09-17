import clientsJson from "./clients.json";
import { TokenBucketConfig } from "../limiters/TokenBucketLimiter";
import { SlidingWindowConfig } from "../limiters/SlidingWindowCounterLimiter";

export interface ClientLimits {
  foo: TokenBucketConfig;
  bar: SlidingWindowConfig;
}

export type ClientRegistry = Record<string, ClientLimits>;

/** Loaded once at process start; no hot-reload (ARCHITECTURE.md §15 Assumptions). */
const clients: ClientRegistry = validate(clientsJson as ClientRegistry);

function validate(registry: ClientRegistry): ClientRegistry {
  for (const [clientId, limits] of Object.entries(registry)) {
    if (limits.foo.capacity <= 0 || limits.foo.refillRatePerSec <= 0) {
      throw new Error(`Invalid /foo (token bucket) config for client "${clientId}": capacity and refillRatePerSec must be > 0`);
    }
    if (limits.bar.limit <= 0 || limits.bar.windowSizeMs <= 0) {
      throw new Error(`Invalid /bar (sliding window) config for client "${clientId}": limit and windowSizeMs must be > 0`);
    }
  }
  return registry;
}

export function getClientLimits(clientId: string): ClientLimits | undefined {
  return clients[clientId];
}

export function isKnownClient(clientId: string): boolean {
  return clientId in clients;
}
