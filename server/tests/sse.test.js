import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import IORedis from 'ioredis';
import { vi } from 'vitest';
import { createHarness, openSse } from './helpers.js';
import { createEventPublisher } from '../src/events/eventBus.js';
import { env } from '../src/config/env.js';

let h;
let workerLikeRedis;
let workerLikePublisher;

beforeAll(async () => {
  h = await createHarness({ worker: false, listenApi: true, heartbeatMs: 100 });
  // A separate Redis connection stands in for the worker process publishing events.
  workerLikeRedis = new IORedis(env.REDIS_URL);
  workerLikePublisher = createEventPublisher(workerLikeRedis, env.REDIS_PREFIX);
});
afterAll(async () => { await workerLikeRedis.quit(); await h.close(); });
beforeEach(async () => { await h.reset(); });

describe('Server-Sent Events', () => {
  it('connects with SSE headers, acknowledges immediately, and cleans up on disconnect', async () => {
    const c = openSse(h.apiPort);
    await c.ready;
    await c.waitFor((f) => f.event === 'connected');
    expect(c.headers['content-type']).toMatch(/text\/event-stream/);
    expect(c.headers['cache-control']).toMatch(/no-cache/);
    expect(h.hub.size).toBe(1);
    c.close();
    await vi.waitFor(() => expect(h.hub.size).toBe(0)); // no leaked client
  });

  it('delivers events published by another process to multiple dashboards', async () => {
    const a = openSse(h.apiPort);
    const b = openSse(h.apiPort);
    await Promise.all([a.ready, b.ready]);
    await Promise.all([a.waitFor((f) => f.event === 'connected'), b.waitFor((f) => f.event === 'connected')]);
    const evt = await workerLikePublisher.publish('sync:completed', { jobId: 'sync_x', status: 'completed' });
    const [fa, fb] = await Promise.all([a.waitFor((f) => f.event === 'sync:completed'), b.waitFor((f) => f.event === 'sync:completed')]);
    expect(fa.id).toBe(evt.id);
    expect(fb.data.data.jobId).toBe('sync_x');
    a.close(); b.close();
  });

  it('sends heartbeat comments on idle connections', async () => {
    const c = openSse(h.apiPort);
    await c.ready;
    await c.waitFor((f) => f.comment === 'heartbeat', 3000);
    c.close();
  });

  it('lets a reconnecting dashboard replay missed events (Last-Event-ID) and re-read current state over REST', async () => {
    const first = openSse(h.apiPort);
    await first.ready;
    await first.waitFor((f) => f.event === 'connected');
    const e1 = await workerLikePublisher.publish('sync:started', { jobId: 'sync_r', status: 'running' });
    await first.waitFor((f) => f.id === e1.id);
    first.close(); // connection drops...
    await vi.waitFor(() => expect(h.hub.size).toBe(0));

    const e2 = await workerLikePublisher.publish('sync:progress', { jobId: 'sync_r', status: 'running' }); // ...events are missed
    const e3 = await workerLikePublisher.publish('sync:completed', { jobId: 'sync_r', status: 'completed' });

    const second = openSse(h.apiPort, { lastEventId: e1.id });
    await second.ready;
    await second.waitFor((f) => f.id === e3.id);
    const ids = second.frames.filter((f) => f.id).map((f) => f.id);
    expect(ids).toEqual([e2.id, e3.id]); // exactly the missed ones, in order, no duplicates
    second.close();

    const status = await request(h.app).get('/api/sync/status').expect(200); // explicit reconciliation path
    expect(status.body.success).toBe(true);
  });

  it('broadcasts a resync hint when the event bus reconnects', async () => {
    const c = openSse(h.apiPort);
    await c.ready;
    await c.waitFor((f) => f.event === 'connected');
    h.hub.broadcastResync();
    await c.waitFor((f) => f.event === 'resync');
    c.close();
  });

  it('refuses new connections beyond the configured cap', async () => {
    const original = h.hub.maxClients;
    h.hub.maxClients = 0;
    const res = await request(h.app).get('/api/events').timeout(2000).expect(503);
    expect(res.body.error.code).toBe('TOO_MANY_CONNECTIONS');
    h.hub.maxClients = original;
  });
});
