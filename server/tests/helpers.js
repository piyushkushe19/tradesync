import http from 'node:http';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { createApiRedis, createWorkerRedis } from '../src/config/redis.js';
import { createLogger } from '../src/utils/logger.js';
import { createSyncQueue } from '../src/queues/syncQueue.js';
import { createEventPublisher, subscribeEvents } from '../src/events/eventBus.js';
import { SseHub } from '../src/events/sseHub.js';
import { createSyncLock } from '../src/services/syncLock.js';
import { createSyncService } from '../src/services/syncService.js';
import { createExchangeClient } from '../src/services/exchangeClient.js';
import { createSyncProcessor } from '../src/workers/syncProcessor.js';
import { createSyncWorker } from '../src/workers/syncWorker.js';
import { createApp } from '../src/app.js';
import { createExchangeApp } from '../src/exchange/app.js';
import { Trade } from '../src/models/Trade.js';
import { SyncJob } from '../src/models/SyncJob.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

/** FerretDB (used for local verification when real MongoDB is unavailable) lacks some aggregation operators. */
export async function isFerretDB() {
  const info = await mongoose.connection.db.admin().command({ buildInfo: 1 });
  return Boolean(info.ferretdbVersion);
}

export async function createHarness({ worker = true, listenApi = false, heartbeatMs = env.SSE_HEARTBEAT_MS } = {}) {
  if (!/\/15$/.test(env.REDIS_URL) && !/test/i.test(env.REDIS_PREFIX)) throw new Error('unsafe redis target for tests');
  const logger = createLogger({ service: 'test' });
  await connectMongo(logger);
  await Promise.all([Trade.init(), SyncJob.init()]);
  await Promise.all([Trade.deleteMany({}), SyncJob.deleteMany({})]);

  const redis = createApiRedis(logger);
  await redis.flushdb(); // isolated test redis db / prefix only

  const exchangeServer = http.createServer(createExchangeApp({ redis }));
  const exchangePort = await listen(exchangeServer);
  const exchangeUrl = `http://127.0.0.1:${exchangePort}`;

  const queue = createSyncQueue(redis);
  await queue.obliterate({ force: true }).catch(() => {});
  const publisher = createEventPublisher(redis, env.REDIS_PREFIX);
  const lock = createSyncLock(redis, env.REDIS_PREFIX, 60_000);
  const hub = new SseHub({ heartbeatMs, maxClients: 50, logger });
  const syncService = createSyncService({ queue, lock, publisher, logger });

  // API-side subscription (what server.js does) feeds the SSE hub.
  const apiSub = redis.duplicate({ maxRetriesPerRequest: null });
  await subscribeEvents(apiSub, env.REDIS_PREFIX, { onEvent: (e) => hub.broadcast(e), onResync: () => hub.broadcastResync() });

  // Independent recorder so tests can await events without polling.
  const events = [];
  const waiters = [];
  const recSub = redis.duplicate({ maxRetriesPerRequest: null });
  await subscribeEvents(recSub, env.REDIS_PREFIX, {
    onEvent: (e) => { events.push(e); waiters.slice().forEach((w) => w.check(e)); },
  });

  function waitForEvent(type, { jobId, timeoutMs = 20000 } = {}) {
    const match = (e) => e.type === type && (!jobId || e.data.jobId === jobId);
    const found = events.find(match);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); waiters.splice(waiters.indexOf(w), 1); };
      const w = { check: (e) => { if (match(e)) { cleanup(); resolve(e); } } };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${type}`)); }, timeoutMs);
      waiters.push(w);
    });
  }

  let bullWorker = null;
  let workerRedis = null;
  let processor = null;
  if (worker) {
    workerRedis = createWorkerRedis(logger);
    processor = createSyncProcessor({ queue, lock, publisher, exchange: createExchangeClient({ baseUrl: exchangeUrl, timeoutMs: 5000 }), config: env, logger });
    bullWorker = createSyncWorker({ connection: workerRedis, processor, concurrency: env.WORKER_CONCURRENCY, prefix: env.REDIS_PREFIX, logger });
    await bullWorker.waitUntilReady();
  }

  const app = createApp({ hub, redis, syncService, logger });
  let apiServer = null;
  let apiPort = null;
  if (listenApi) { apiServer = http.createServer(app); apiPort = await listen(apiServer); }

  return {
    app, hub, redis, queue, lock, publisher, logger, events, waitForEvent, exchangeUrl, apiPort, processor, syncService,
    setExchangeMode: (mode) => redis.set(`${env.REDIS_PREFIX}:exchange:mode`, mode),
    async reset() {
      await Promise.all([Trade.deleteMany({}), SyncJob.deleteMany({})]);
      await redis.del(`${env.REDIS_PREFIX}:lock:sync`, `${env.REDIS_PREFIX}:exchange:mode`);
      events.length = 0;
    },
    async close() {
      hub.closeAll();
      await bullWorker?.close();
      await queue.close();
      await new Promise((r) => (apiServer ? apiServer.close(r) : r()));
      await new Promise((r) => exchangeServer.close(r));
      await Promise.allSettled([apiSub.quit(), recSub.quit(), redis.quit(), workerRedis?.quit()]);
      await disconnectMongo();
    },
  };
}

/** Minimal SSE client for tests. */
export function openSse(port, { lastEventId } = {}) {
  const frames = [];
  const waiters = [];
  let buffer = '';
  let req;
  let headers;
  const ready = new Promise((resolve, reject) => {
    req = http.get({ host: '127.0.0.1', port, path: '/api/events', headers: { Accept: 'text/event-stream', ...(lastEventId != null ? { 'Last-Event-ID': String(lastEventId) } : {}) } }, (res) => {
      headers = res.headers;
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const frame = { raw };
          for (const line of raw.split('\n')) {
            if (line.startsWith('event: ')) frame.event = line.slice(7);
            else if (line.startsWith('id: ')) frame.id = Number(line.slice(4));
            else if (line.startsWith('data: ')) frame.data = JSON.parse(line.slice(6));
            else if (line.startsWith(': ')) frame.comment = line.slice(2);
          }
          frames.push(frame);
          waiters.slice().forEach((w) => w());
        }
      });
      resolve();
    });
    req.on('error', reject);
  });
  const waitFor = (pred, timeoutMs = 10000) => new Promise((resolve, reject) => {
    const check = () => { const f = frames.find(pred); if (f) { cleanup(); resolve(f); } };
    const cleanup = () => { clearTimeout(t); waiters.splice(waiters.indexOf(check), 1); };
    const t = setTimeout(() => { cleanup(); reject(new Error('SSE wait timed out')); }, timeoutMs);
    waiters.push(check);
    check();
  });
  return { frames, ready, waitFor, get headers() { return headers; }, close: () => req.destroy() };
}
