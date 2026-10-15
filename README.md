# TradeSync

A MERN dashboard that synchronizes trades from a (mock) BSE exchange whose full pull can take **up to 15 minutes**, on a network that **kills any HTTP connection held open for more than 30 seconds**.

> **The solution in one line:** no HTTP request ever waits for the pull. `POST /api/sync` enqueues a BullMQ job and returns **202** in milliseconds; a separate worker process runs the pull; the browser learns about completion through **Server-Sent Events**, then fetches the new data over short REST calls. No polling, no cron.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for diagrams and design rationale, and [DEMO_SCRIPT.md](./DEMO_SCRIPT.md) for the video walkthrough script.

## Assignment requirements → where they are met

| Requirement | Implementation |
|---|---|
| `GET /getTrades` returns seeded trades (a few thousand: trade ID, client, symbol, quantity, price, timestamp) | `server/src/exchange/` – deterministic generator, 5,000 records by default |
| Configurable pull duration up to 15 min | `EXCHANGE_PULL_DELAY_MS` (`900000` = 15 min) applied to the async pull protocol (`POST /pulls`, `GET /pulls/:id`) |
| Dashboard opens instantly, shows already-pulled trades during a pull | Dashboard reads MongoDB through `GET /api/trades`; SSE is opened independently of data loading |
| New trades appear automatically – no refresh, no polling loop, no cron | `sync:completed` / `trades:updated` SSE events trigger one-off REST refreshes. The client contains no `setInterval` and no recurring fetch |
| Git repo + README + architecture note + video | this repo, `README.md`, `ARCHITECTURE.md`, `DEMO_SCRIPT.md` (the video itself has to be recorded by you) |

### About `GET /getTrades`
`GET /getTrades` is kept exactly as specified and returns the seeded dataset **immediately**. If it also slept for 15 minutes it would recreate the very timeout problem we are solving. The "slow pull" is therefore modelled the way real long-running APIs work – as an **asynchronous operation**:

1. `POST /pulls` → `202 {operationId, readyAt, retryAfterMs}` (instant)
2. `GET /pulls/:id` → `{status:"pending", retryAfterMs}` until the configured delay elapsed, then `{status:"completed", trades:[…]}` (instant either way)

Every HTTP exchange is milliseconds long; only the *operation* lasts 15 minutes.

## Features
- Separate processes: **API**, **worker**, **mock exchange**, **React client**
- BullMQ + Redis job queue with retries, exponential backoff, bounded concurrency, graceful shutdown
- Waiting for the exchange is a **delayed BullMQ job**, not a held connection, timer, or worker slot
- Idempotent ingestion (`bulkWrite` upserts on unique `tradeId`), validation before any write
- Redis lock with compare-and-delete release → one active sync across all API instances (HTTP 409 otherwise)
- Redis pub/sub bridge from worker → API → SSE clients; Last-Event-ID replay; heartbeat; `resync` hint
- Server-side pagination, search, symbol/date filters, sorting; stats via MongoDB aggregation
- Money stored as **integer paise** (see below)
- 32 automated tests (Vitest + Supertest)

## Stack
React 18 · Vite 6 · Tailwind CSS 4 · Lucide · Recharts · native `EventSource` — Node 20+ · Express 4 · Mongoose 8 · BullMQ 5 · ioredis · Zod · Helmet · express-rate-limit — MongoDB · Redis. Plain JavaScript only (no TypeScript).

## Repository structure
```
tradesync/
├── client/                 React dashboard (Vite)
│   └── src/{components,pages,hooks,services,utils}
├── server/
│   ├── src/
│   │   ├── config/         env validation (Zod), Mongo, Redis
│   │   ├── controllers/ routes/ middleware/   Express layer
│   │   ├── models/         Trade, SyncJob
│   │   ├── services/       sync service, lock, exchange client, ingestion, trade queries
│   │   ├── queues/         BullMQ queue
│   │   ├── workers/        job processor + BullMQ worker
│   │   ├── events/         Redis event bus + SSE hub
│   │   ├── exchange/       mock BSE exchange (own process)
│   │   ├── server.js       API entrypoint
│   │   └── worker.js       worker entrypoint
│   └── tests/
├── docker-compose.yml      MongoDB 7 + Redis 7
├── .env.example
├── ARCHITECTURE.md  DEMO_SCRIPT.md
└── package.json            npm workspaces + root scripts
```

## Prerequisites
Node.js ≥ 20, npm ≥ 10, and **either** Docker **or** local MongoDB ≥ 6 and Redis ≥ 6.

## Quick start (from a clean checkout)
```bash
git clone <your-repo-url> tradesync && cd tradesync
npm install                 # installs server + client workspaces
cp .env.example .env        # safe local defaults, no secrets
npm run infra:up            # docker compose: MongoDB :27017 + Redis :6379 (waits for health)
npm run dev                 # exchange + API + worker + client, one terminal, colour-coded
```
Open **http://localhost:5173**, click **Start Sync**. With the default 10 s pull delay the whole flow takes ~15 s.

### Running each process in its own terminal
```bash
npm run dev:exchange   # mock BSE exchange   → http://localhost:4100
npm run dev:api        # dashboard API + SSE → http://localhost:4000
npm run dev:worker     # BullMQ worker
npm run dev:client     # Vite dev server     → http://localhost:5173 (proxies /api to :4000)
```
Production-style: `npm run start:exchange`, `npm run start:api`, `npm run start:worker`, and `npm run build` (serves `client/dist` from any static host; set `VITE_API_URL` at build time if the API is on another origin and add that origin to `CLIENT_URL`).

### MongoDB / Redis without Docker
Install and start them locally, then keep the default URLs, or edit `MONGODB_URI` / `REDIS_URL` in `.env`.
```bash
# macOS (Homebrew)           # Debian/Ubuntu
brew services start redis    sudo apt install redis-server
                             # MongoDB: https://www.mongodb.com/docs/manual/installation/
```

## Configuration (`.env`)
| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `EXCHANGE_PORT` | 4000 / 4100 | API / mock exchange ports |
| `MONGODB_URI`, `REDIS_URL`, `REDIS_PREFIX` | local | datastores; prefix namespaces Redis keys & queues |
| `CLIENT_URL` | `http://localhost:5173` | allowed CORS origin(s), comma separated |
| `EXCHANGE_URL` | `http://127.0.0.1:4100` | where the worker reaches the exchange |
| `EXCHANGE_PULL_DELAY_MS` | `10000` | duration of one exchange pull |
| `EXCHANGE_TRADE_COUNT` | `5000` | dataset size (3,000+ recommended) |
| `EXCHANGE_OPERATION_TIMEOUT_MS` | `1200000` | worker abandons a pull after this long (must exceed the delay) |
| `EXCHANGE_HTTP_TIMEOUT_MS` | `20000` | per-request timeout to the exchange (validated `< 30000`) |
| `JOB_ATTEMPTS`, `JOB_BACKOFF_MS` | 3, 2000 | BullMQ retries and exponential backoff base |
| `WORKER_CONCURRENCY` | 2 | jobs in flight per worker process |
| `BULK_CHUNK_SIZE` | 1000 | trades per `bulkWrite` |
| `MAX_INVALID_RATIO` | 0.05 | fail the job if more than this share of records is malformed |
| `SSE_HEARTBEAT_MS`, `MAX_SSE_CLIENTS` | 15000, 500 | keep-alive interval and connection cap |

Invalid or missing values stop the process at startup with a readable list of problems.

### Development mode vs. 15-minute assessment simulation
```bash
# Development (default): 10 s
EXCHANGE_PULL_DELAY_MS=10000
# Assessment simulation: 15 minutes
EXCHANGE_PULL_DELAY_MS=900000
```
Edit `.env`, restart **only the exchange** (`npm run dev:exchange`, or just `npm run dev`). The worker needs no change (`EXCHANGE_OPERATION_TIMEOUT_MS` defaults to 20 min). Tests never use a long delay.

## Using the mock exchange directly
```bash
curl localhost:4100/getTrades | head -c 300                     # dataset snapshot (instant)
curl -X POST localhost:4100/pulls                               # → 202 {operationId, retryAfterMs}
curl localhost:4100/pulls/<operationId>                         # pending… then completed + trades
# Dev-only fault injection for the NEXT pulls: none | fail | malformed
curl -X POST localhost:4100/admin/mode -H 'content-type: application/json' -d '{"mode":"fail"}'
```
To inspect stored data: `curl 'localhost:4000/api/trades?limit=5&symbol=TCS&sortBy=price'` or use `mongosh tradesync --eval 'db.trades.countDocuments()'`. Records are deterministic (record *i* depends only on *i*), so raising `EXCHANGE_TRADE_COUNT` and restarting the exchange makes the next sync add exactly the new trades.

## REST API
All responses: `{ "success": true, "data": …, "meta"?: … }` or `{ "success": false, "error": { "code", "message", "details"? } }`.

| Method & path | Description |
|---|---|
| `GET /api/trades` | Paginated trades. Query: `page` (≥1), `limit` (1–100, default 25), `search` (≤50 chars; matches tradeId/client/symbol), `symbol`, `sortBy` (`timestamp\|tradeId\|client\|symbol\|quantity\|price`), `sortOrder`, `from`, `to` (ISO-8601). Unknown keys → 400 |
| `GET /api/trades/stats` | totals, distinct symbols, quantity, notional value, top symbols, latest successful sync, current sync |
| `POST /api/sync` | Queue a sync → **202**; **409** if one is already active; **503** if Redis/Mongo is down |
| `GET /api/sync/status` | `{ active, latest, lastSuccessful }` |
| `GET /api/sync/jobs` | Paginated history (`page`, `limit` ≤ 50) |
| `GET /api/events` | SSE stream |
| `GET /api/health` | Mongo / Redis / SSE client count (503 when degraded) |

```jsonc
// POST /api/sync → 202
{ "success": true, "data": { "jobId": "sync_3f9a1c0b7d2e", "status": "queued",
  "message": "Trade synchronization queued successfully", "createdAt": "2026-10-15T00:00:00.000Z" } }

// GET /api/trades?limit=1
{ "success": true,
  "data": [{ "tradeId": "BSE-2026-000133", "client": "CLIENT-1001", "symbol": "MARUTI",
             "quantity": 200, "price": 12685.6, "timestamp": "2026-10-14T03:53:49.019Z" }],
  "meta": { "pagination": { "page": 1, "limit": 1, "total": 5000, "totalPages": 5000 } } }

// POST /api/sync while active → 409
{ "success": false, "error": { "code": "SYNC_IN_PROGRESS", "message": "A synchronization is already in progress",
  "details": { "activeJobId": "sync_3f9a1c0b7d2e" } } }
```

## SSE events
Each frame has an `id`, an `event` name, and JSON `data` of the form `{ id, type, at, data: { jobId, status, job, … } }`, where `job` is the serialized sync job (no trade records are ever sent over SSE).

| Event | Published when |
|---|---|
| `connected` | immediately on connect (no id) |
| `sync:queued` | API accepted the request (after the job row + queue entry exist) |
| `sync:started` | worker claimed the job |
| `sync:progress` | phase changes: `awaiting_exchange`, `persisting` (with processed counts), `retrying`. The exchange reports no percentage, so none is invented |
| `sync:completed` | **only after** all bulk writes succeeded and the job row is `completed` |
| `trades:updated` | right after completion; dashboards re-fetch trades + stats |
| `sync:failed` | job failed permanently (error message included) |
| `resync` | API lost/regained its Redis subscription; clients should re-fetch (no id) |

On reconnect the browser sends `Last-Event-ID`; the API replays up to the last 200 events, and the dashboard additionally re-fetches current state over REST.

## Money representation
Prices are stored as **integer paise** (`priceMinor`, ₹1425.75 → `142575`) and notional value as integer paise (`notionalMinor = priceMinor × quantity`, precomputed at ingest). Sums are exact integer arithmetic (no binary floating-point drift in totals); conversion to rupees happens only when serializing responses.

## Testing
```bash
npm run infra:up           # tests need MongoDB + Redis
npm test                   # 32 tests: exchange, API, worker workflow, SSE, API↔worker as separate processes
npm run lint
npm run build
```
Tests use database `tradesync_test` and Redis db `15` / prefix `tradesync_test` (override with `TEST_MONGODB_URI`, `TEST_REDIS_URL`). The suite **refuses to run** against a database whose name does not contain "test" and flushes only that Redis namespace. A 400 ms exchange delay and 60 trades keep the suite at ~30 s; no test waits 15 minutes.

## Troubleshooting
| Symptom | Fix |
|---|---|
| `Invalid environment configuration` at startup | read the listed variables; copy `.env.example` again |
| `ECONNREFUSED 27017` / `6379` | `npm run infra:up` (or start local services) |
| Start Sync stays *Queued* | the worker isn't running (`npm run dev:worker`) |
| Sync fails with "Exchange unreachable" | start `npm run dev:exchange`; check `EXCHANGE_URL` |
| 409 on Start Sync | a sync is genuinely active; the lock frees on completion/failure or after its TTL |
| Header shows "Reconnecting…" | API is down/restarting; the dashboard reconciles automatically when SSE reopens |
| CORS errors | add the client origin to `CLIENT_URL` |

## Known limitations
- **Dashboard is unauthenticated** – a development/demo assumption. Put it behind auth/VPN before real use.
- SSE connections are themselves long-lived HTTP requests. If your network enforces a *hard* 30 s cap on **any** request (not just idle ones), the browser reconnects every ~30 s; `Last-Event-ID` replay + explicit REST reconciliation keep state correct, and heartbeats cover idle-timeout proxies. This is an inherent trade-off of any push channel; WebSockets or long-poll would face the same cap.
- Replay buffer holds the last 200 events in Redis; older gaps are covered by the REST reconciliation.
- After a retried persistence step, `insertedTradeCount`/`updatedTradeCount` describe the *final* attempt only (earlier partial inserts count as "existing"). Data is always correct; only the split can differ.
- If Redis loses all data (flush, no persistence) a job in flight loses its queue entry; the worker's startup reconciliation marks it failed and frees the lock. A Redis outage mid-job is survivable only to the extent Redis persistence (AOF is enabled in `docker-compose.yml`) preserves state.
- If the exchange process loses its Redis state, outstanding pull operations 404 and the job fails (user can re-sync).
- The whole exchange payload is read into worker memory (≈0.7 MB for 5,000 trades). Much larger datasets need a paginated/streamed exchange protocol.
- Only one synchronization at a time (by design). MongoDB transactions are not used; correctness relies on idempotent upserts.

## Future production improvements
Authentication/RBAC; BullMQ Flows or exchange-side cursors for very large pulls; metrics (Prometheus) and tracing; a dedicated Redis Stream for events with consumer groups; Mongo replica set + `majority` write concern; per-tenant rate limits; CI pipeline running the test-suite against real MongoDB/Redis.
