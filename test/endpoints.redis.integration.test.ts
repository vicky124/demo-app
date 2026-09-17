import RedisMock from "ioredis-mock";
import type { Redis } from "ioredis";
import { RedisStore } from "../src/storage/RedisStore";
import { describeEndpointContract } from "./helpers/endpointContract";

// ioredis-mock implements the subset of the ioredis API RedisStore relies on
// (get/set/watch/multi/exec) in-memory, so the exact same test contract can
// run against "Redis" without a real server — proving RedisStore satisfies
// the identical HTTP behavior as MemoryStore (ARCHITECTURE.md R10/R11).
describeEndpointContract(
  "redis (ioredis-mock)",
  () => new RedisStore(new RedisMock() as unknown as Redis),
  (store) => (store as RedisStore).close()
);
