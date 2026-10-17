# Video walkthrough script (≈ 2½ minutes)

**Before recording:** `npm run infra:up`, set `EXCHANGE_PULL_DELAY_MS=10000` (default), clear data if you want an empty first run (`docker compose down -v && npm run infra:up`), then `npm run dev`. Open `http://localhost:5173` in one window and a terminal next to it.

| Time | Show | Say |
|---|---|---|
| 0:00 | Slide / README intro | "A trade pull from the BSE API takes up to 15 minutes, but our network kills any HTTP request after 30 seconds. So no request may ever wait for the pull." |
| 0:15 | ARCHITECTURE.md component diagram | "The API only *accepts* a sync request: it enqueues a BullMQ job in Redis and returns 202. A separate worker runs the pull. The worker publishes events through Redis pub/sub; the API relays them to browsers over Server-Sent Events." |
| 0:35 | Open the dashboard (first run: empty state; later runs: table filled) | "The dashboard opens instantly, straight from MongoDB. The green *Live* pill is the SSE connection, which is opened independently of the data requests." |
| 0:50 | Terminal: `curl -s -w '\nHTTP %{http_code} in %{time_total}s\n' -X POST localhost:4000/api/sync` | "Starting a sync returns **202 in well under a second** — here it is, with the job ID." *(Then click **Start Sync** in the UI if you ran curl first only for timing; the second request will 409 – show that too: "only one sync at a time".)* |
| 1:05 | Dashboard: status badge Queued → Running, button disabled, job ID, phase text | "Queued and running are separate states. The exchange reports no progress, so I show an honest status instead of a fake percentage." |
| 1:15 | Scroll/sort/search the trades table while running | "The table stays fully usable during the pull — pagination, search, filters and sorting are all server-side." |
| 1:30 | Browser DevTools → Network → `events` (EventStream tab) | "Here are the SSE frames: `sync:started`, `sync:progress`, and later `sync:completed`. No polling — there is no recurring request on this page." |
| 1:45 | Pull completes: toast, cards and table update, history row turns green | "On completion the worker has *already* committed the trades, then publishes `sync:completed`. The dashboard re-fetches the current page and stats — no refresh." |
| 2:00 | Sync history panel | "Every job is recorded: status, start/end, duration, processed, inserted vs. existing, errors." |
| 2:10 *(optional)* | `curl -X POST localhost:4100/admin/mode -H 'content-type: application/json' -d '{"mode":"fail"}'`, Start Sync | "Fault injection: the exchange fails, the job is marked failed with a clear error, a red toast appears, and the lock is released so I can retry." Reset with `{"mode":"none"}`. |
| 2:25 | README "Development vs. 15-minute" section | "To simulate the real 15-minute pull set `EXCHANGE_PULL_DELAY_MS=900000` and restart the exchange. Nothing else changes: the wait is a delayed job in Redis, not an open connection." |

## Switching modes
```bash
# .env
EXCHANGE_PULL_DELAY_MS=10000     # development demo
EXCHANGE_PULL_DELAY_MS=900000    # 15-minute simulation (restart the exchange process)
```

## Honesty notes for the recording
- The automated tests and the demo use short delays. Do **not** claim a 15-minute run was observed unless you actually let one complete (set `900000` and wait) before recording.
- The dashboard has no authentication (demo assumption).
