# demo-app — API Throttling Service

A small HTTP API demonstrating **API throttling (rate limiting)**. It exposes two
endpoints, each protected by a **different, hand-rolled rate-limiting algorithm**,
enforced **per client**, with a choice of **two interchangeable storage backends**
for the rate-limit counters.

Full design rationale, diagrams, and the requirements this implementation satisfies
are in **[ARCHITECTURE.md](./ARCHITECTURE.md)** — read that for the "why"; this
file covers the "how to run it".

| Endpoint | Algorithm |
|---|---|
| `GET /foo` | Token Bucket (burst-tolerant) |
| `GET /bar` | Sliding Window Counter (smooths fixed-window edge bursts) |

Both rate-limiting algorithms are implemented from scratch (`src/limiters/`) —
no `express-rate-limit` or similar library is used for the throttling logic itself.

---

## 1. Requirements

- Node.js **18+** (developed and tested on Node 20/24)
- npm (ships with Node)
- Docker + Docker Compose — **only** needed to run the Redis-backed storage
  strategy locally or to run the whole stack in containers. Not required to run
  the app itself with the in-memory storage strategy.

---

## 2. Quick start (in-memory storage)

```bash
npm install
npm run build
cp .env.example .env
npm start
```

The server listens on `http://localhost:3000` with `STORAGE_DRIVER=memory` by default.

Try it:

```bash
curl -i http://localhost:3000/foo -H "Authorization: bearer client-a"
curl -i http://localhost:3000/bar -H "Authorization: bearer client-a"
```

For local development with auto-reload on file changes:

```bash
npm run dev
```

---

## 3. Running with Redis (persistent storage strategy)

### Option A — Docker Compose (app + Redis together)

```bash
docker compose up --build
```

This builds the app image, starts a Redis container, and wires the app to it via
`STORAGE_DRIVER=redis` / `REDIS_URL=redis://redis:6379` (see `docker-compose.yml`).
The app is reachable at `http://localhost:3000`, same as the in-memory quick start.

### Option B — Local Redis, app run directly

```bash
docker run -p 6379:6379 redis:7-alpine
```

```bash
STORAGE_DRIVER=redis REDIS_URL=redis://localhost:6379 npm start
```

### Proving persistence

Restart the **app** process (not Redis) between requests — under `STORAGE_DRIVER=redis`
the counters survive because they live in Redis, not in the app's memory:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/foo -H "Authorization: bearer client-b" # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/foo -H "Authorization: bearer client-b" # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/foo -H "Authorization: bearer client-b" # 200 (capacity 3 exhausted)
# ctrl-C the app, npm start it again, then immediately:
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/foo -H "Authorization: bearer client-b" # 429 — state survived the restart
```

Repeat the same sequence with `STORAGE_DRIVER=memory` and the last request comes
back `200` instead — the in-memory counters were wiped by the restart, by design.

---

## 4. API

### `GET /foo` — Token Bucket

| Response | When |
|---|---|
| `200 { "success": true }` | Under the client's token-bucket capacity |
| `429 { "error": "rate limit exceeded" }` | Bucket empty |
| `401 { "error": "unauthorized" }` | Missing/malformed `Authorization` header, or unknown client |
| `503 { "error": "rate limiter unavailable" }` | `STORAGE_DRIVER=redis` and Redis is unreachable |

### `GET /bar` — Sliding Window Counter

Same response contract as `/foo`.

### Authentication

Every request must include:

```
Authorization: bearer <client-id>
```

`<client-id>` identifies which client's configured limits apply (see §5). This is
a client **identifier**, not a secret credential.

---

## 5. Configured clients

Two clients are preconfigured in [`src/config/clients.json`](./src/config/clients.json)
with deliberately different limits so the two algorithms' behavior is easy to tell apart:

| Client | `/foo` (Token Bucket) | `/bar` (Sliding Window Counter) |
|---|---|---|
| `client-a` | capacity **10**, refills 1 token/sec | limit **5** requests / 10s window |
| `client-b` | capacity **3**, refills 0.2 tokens/sec | limit **20** requests / 10s window |

Add a client or change a limit by editing `clients.json` (requires an app restart —
config is loaded once at startup, see [ARCHITECTURE.md §15](./ARCHITECTURE.md#15-assumptions)).

---

## 6. Demo script — all combinations

The task calls for demonstrating **2 clients × 2 endpoints × 2 storage strategies**.
[`demo/requests.http`](./demo/requests.http) has the full walkthrough (openable
directly in VS Code's REST Client extension, or copy the `curl` commands out).
Summary:

```bash
# --- storage: memory (default) ---
npm start

# client-a burst on /foo (capacity 10) — first 10 succeed, 11th throttles
for i in $(seq 1 11); do curl -s -o /dev/null -w "%{http_code} " http://localhost:3000/foo -H "Authorization: bearer client-a"; done; echo

# client-b's much smaller /foo burst (capacity 3) throttles almost immediately
for i in $(seq 1 4); do curl -s -o /dev/null -w "%{http_code} " http://localhost:3000/foo -H "Authorization: bearer client-b"; done; echo

# client-a and client-b on /bar track independent sliding windows
for i in $(seq 1 6); do curl -s -o /dev/null -w "%{http_code} " http://localhost:3000/bar -H "Authorization: bearer client-a"; done; echo
for i in $(seq 1 6); do curl -s -o /dev/null -w "%{http_code} " http://localhost:3000/bar -H "Authorization: bearer client-b"; done; echo

# --- storage: redis ---
docker compose up --build
# repeat the same four curl loops against the same URLs — identical HTTP behavior,
# now backed by Redis and durable across app restarts (see §3).
```

---

## 7. Testing

```bash
npm test
```

26 tests across 5 suites, run with Jest + ts-jest + Supertest:

| File | What it covers |
|---|---|
| `test/tokenBucket.unit.test.ts` | Token Bucket algorithm: burst/throttle behavior, refill over time, per-client isolation, and a concurrency test proving `Promise.all`-fired simultaneous requests are still capped exactly at capacity (no check-then-act race) |
| `test/slidingWindow.unit.test.ts` | Sliding Window Counter: limit enforcement, boundary smoothing vs. a naive fixed window, full reset once clear of the previous window, per-client isolation, concurrency cap |
| `test/redisStore.unit.test.ts` | `RedisStore`'s atomic-update contract in isolation: round-trip, TTL expiry, and the same concurrency-cap guarantee against `ioredis-mock` |
| `test/endpoints.memory.integration.test.ts` | Full HTTP contract (`GET /foo`/`/bar`, auth, 200/401/429) against a real `MemoryStore` via Supertest |
| `test/endpoints.redis.integration.test.ts` | The **identical** HTTP contract test suite (`test/helpers/endpointContract.ts`) run again against `RedisStore` backed by `ioredis-mock` — proving both storage strategies satisfy the same behavior |

`ioredis-mock` implements the real Redis wire protocol semantics for `GET`/`SET`/`WATCH`/`MULTI`/`EXEC`
in-memory, so `RedisStore` is exercised without needing a live Redis server in CI.
It is not a stub — it's what caught a real concurrency bug during development (see
§8, "Implementation notes").

---

## 8. Implementation notes / deviations from the initial design

While implementing against [ARCHITECTURE.md](./ARCHITECTURE.md), one detail changed
based on what testing surfaced, worth calling out explicitly rather than leaving silent:

- **`RedisStore` atomicity uses WATCH/MULTI/EXEC optimistic locking with a
  duplicated connection per attempt, not a single shared connection.**
  The original plan executed the update via a shared client connection. Under
  a concurrency test (many simultaneous requests for one client), this let
  15 concurrent requests all succeed against a capacity of 5 — because Redis's
  `WATCH`/`MULTI`/`EXEC` state is scoped to a *connection*, not to a logical
  transaction, and concurrent callers sharing one connection stomp on each
  other's watched-key state. The fix — verified by first reproducing the bug,
  then confirming the fix — is for each `atomicUpdate` attempt to run on its
  own connection via `client.duplicate()`, released when the attempt completes,
  with jittered retry backoff under contention. See the doc comment in
  [`src/storage/RedisStore.ts`](./src/storage/RedisStore.ts) for the full
  explanation. This keeps the store fully generic (the exact same `updateFn`
  runs against both `MemoryStore` and `RedisStore` — no per-algorithm Lua
  script duplication needed) at the cost of a connection-setup per attempt,
  which is an acceptable tradeoff at this demo's scale; a production
  deployment under heavy load would use a small pool of dedicated transaction
  connections instead of duplicating per call.

---

## 9. Project structure

```
src/
├── index.ts                          # process entrypoint: reads env, builds store, starts HTTP server
├── app.ts                            # wires routes/middleware/limiters onto an injected RateLimitStore
├── config/
│   ├── clients.ts                    # loads + validates clients.json
│   └── clients.json                  # per-client rate-limit configuration
├── middleware/
│   ├── auth.ts                       # Authorization header parsing -> req.client
│   └── rateLimit.ts                  # generic middleware; depends only on the RateLimiter interface
├── limiters/
│   ├── RateLimiter.ts                # interface
│   ├── TokenBucketLimiter.ts         # /foo
│   └── SlidingWindowCounterLimiter.ts # /bar
├── storage/
│   ├── RateLimitStore.ts             # interface + StoreRecord/UpdateResult types
│   ├── MemoryStore.ts                # in-process Map, lazy + swept TTL expiry
│   ├── RedisStore.ts                 # WATCH/MULTI/EXEC-based atomic store
│   └── index.ts                      # factory: STORAGE_DRIVER -> concrete store
├── utils/respond.ts                  # shared 200/401/429/503 response helpers
└── types/express.d.ts                # augments Express.Request with `client`

test/
├── tokenBucket.unit.test.ts
├── slidingWindow.unit.test.ts
├── redisStore.unit.test.ts
├── endpoints.memory.integration.test.ts
├── endpoints.redis.integration.test.ts
└── helpers/endpointContract.ts       # shared HTTP contract test, run against each store

demo/requests.http                    # manual walkthrough covering the full 2×2×2 matrix
Dockerfile, docker-compose.yml        # containerized app (+ Redis for the persistent driver)
ARCHITECTURE.md                       # full design document, diagrams, requirements traceability
```

---

## 10. Design principles

The codebase follows SOLID:

- **Single Responsibility** — auth parsing, rate-limit decisioning, storage, and
  route wiring are each their own module; none of them know about the others'
  internals.
- **Open/Closed** — adding a third algorithm or a third storage backend means
  adding a new class that implements `RateLimiter` or `RateLimitStore`; no
  existing code changes.
- **Liskov Substitution** — `MemoryStore` and `RedisStore` are drop-in
  replacements for each other everywhere `RateLimitStore` is used (proven by
  running the identical test suite against both, §7); same for the two
  `RateLimiter` implementations.
- **Interface Segregation** — `RateLimitStore` exposes only `get`/`atomicUpdate`;
  `RateLimiter` exposes only `check`. Neither interface forces a consumer to
  depend on methods it doesn't use.
- **Dependency Inversion** — limiters and route handlers depend on the
  `RateLimiter`/`RateLimitStore` abstractions, injected via constructor/factory
  (`src/app.ts`, `src/storage/index.ts`), never on a concrete class directly.

---

## 11. Deployment (stretch goal)

The `Dockerfile` builds a production image; `docker-compose.yml` is for local
development. To deploy to a cloud provider (Render, Railway, Fly.io, etc.):

1. Push this repository (already done if you're reading it on GitHub).
2. Create a Node/Docker web service pointed at this repo, and a managed Redis
   add-on.
3. Set env vars: `STORAGE_DRIVER=redis`, `REDIS_URL=<provider-supplied URL>`,
   `PORT=<provider-supplied port>`.
4. The reviewer can then run the same `curl` commands from §6 against the
   public URL instead of `localhost`.

See [ARCHITECTURE.md §14](./ARCHITECTURE.md#14-deployment-stretch-goal) for the
deployment diagram.
