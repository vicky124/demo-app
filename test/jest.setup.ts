import { EventEmitter } from "events";

// Concurrency tests deliberately fire many parallel RedisStore.atomicUpdate
// calls, each duplicating a connection (see src/storage/RedisStore.ts). Against
// ioredis-mock this can register more listeners than EventEmitter's default
// cap of 10 on a shared internal emitter — expected under this test's load,
// not a real leak — so raise the cap for the test process only.
EventEmitter.defaultMaxListeners = 50;
