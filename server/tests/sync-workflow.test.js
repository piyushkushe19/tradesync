import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createHarness } from './helpers.js';
import { Trade } from '../src/models/Trade.js';
import { SyncJob } from '../src/models/SyncJob.js';
import { reconcileOrphanedJobs } from '../src/workers/syncProcessor.js';
import { env } from '../src/config/env.js';

let h;
beforeAll(async () => { h = await createHarness({ worker: true }); });
afterAll(async () => { await h.close(); });
beforeEach(async () => { await h.reset(); });

const start = async () => (await request(h.app).post('/api/sync').expect(202)).body.data.jobId;

describe('background synchronization workflow', () => {
  it('stores trades in the worker and emits completion only AFTER persistence', async () => {
    const jobId = await start();
    // The moment the completion event is observed, the data must already be committed.
    await h.waitForEvent('sync:completed', { jobId });
    const job = await SyncJob.findOne({ jobId });
    expect(job.status).toBe('completed');
    expect(await Trade.countDocuments()).toBe(60);
    expect(job).toMatchObject({ processedTradeCount: 60, insertedTradeCount: 60, expectedTradeCount: 60 });
    expect(job.durationMs).toBeGreaterThanOrEqual(300); // it really waited for the (400 ms) exchange delay
    await h.waitForEvent('trades:updated', { jobId });

    const order = h.events.filter((e) => e.data.jobId === jobId).map((e) => e.type);
    expect(order.indexOf('sync:queued')).toBeLessThan(order.indexOf('sync:started'));
    expect(order.indexOf('sync:started')).toBeLessThan(order.indexOf('sync:completed'));
    expect(order.indexOf('sync:completed')).toBeLessThan(order.indexOf('trades:updated'));
    expect(order).toContain('sync:progress');
  });

  it('the POST returns before the pull finishes and trades stay readable during it', async () => {
    const t0 = Date.now();
    const jobId = await start();
    const responseMs = Date.now() - t0;
    expect(responseMs).toBeLessThan(400); // exchange delay is 400ms: the request did not wait for it
    expect((await SyncJob.findOne({ jobId })).status).not.toBe('completed');
    await request(h.app).get('/api/trades').expect(200); // dashboard stays usable mid-pull
    await h.waitForEvent('sync:completed', { jobId });
  });

  it('is idempotent: re-syncing the same dataset creates no duplicate trades', async () => {
    const first = await start();
    await h.waitForEvent('sync:completed', { jobId: first });
    const second = await start();
    await h.waitForEvent('sync:completed', { jobId: second });
    expect(await Trade.countDocuments()).toBe(60);
    const job = await SyncJob.findOne({ jobId: second });
    expect(job).toMatchObject({ insertedTradeCount: 0, updatedTradeCount: 60 });
    expect(await Trade.distinct('tradeId')).toHaveLength(60);
  });

  it('records a failed pull as a failed job, emits sync:failed and frees the lock', async () => {
    await h.setExchangeMode('fail');
    const jobId = await start();
    const evt = await h.waitForEvent('sync:failed', { jobId });
    expect(evt.data.error).toMatch(/exchange pull failed/i);
    const job = await SyncJob.findOne({ jobId });
    expect(job.status).toBe('failed');
    expect(job.errorMessage).toMatch(/Simulated exchange failure/);
    expect(await Trade.countDocuments()).toBe(0);
    await h.setExchangeMode('none');
    await start(); // lock was released, a new sync is accepted
    expect(h.events.some((e) => e.type === 'sync:completed' && e.data.jobId === jobId)).toBe(false);
  });

  it('rejects malformed exchange data before writing anything', async () => {
    await h.setExchangeMode('malformed');
    const jobId = await start();
    await h.waitForEvent('sync:failed', { jobId });
    expect((await SyncJob.findOne({ jobId })).errorMessage).toMatch(/malformed/i);
    expect(await Trade.countDocuments()).toBe(0);
  });

  it('never marks a job completed when persistence fails (retries, then fails)', async () => {
    const spy = vi.spyOn(Trade, 'bulkWrite').mockRejectedValue(new Error('disk full'));
    try {
      const jobId = await start();
      await h.waitForEvent('sync:failed', { jobId });
      const job = await SyncJob.findOne({ jobId });
      expect(job.status).toBe('failed');
      expect(job.errorMessage).toMatch(/disk full/);
      expect(h.events.some((e) => e.type === 'sync:completed')).toBe(false);
      expect(h.events.some((e) => e.type === 'trades:updated')).toBe(false);
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2); // retried (JOB_ATTEMPTS=2)
    } finally {
      spy.mockRestore();
    }
  });

  it('recovers after a transient persistence failure via BullMQ retry', async () => {
    const real = Trade.bulkWrite.bind(Trade);
    let calls = 0;
    const spy = vi.spyOn(Trade, 'bulkWrite').mockImplementation((...args) => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('transient')) : real(...args);
    });
    try {
      const jobId = await start();
      await h.waitForEvent('sync:completed', { jobId });
      expect(await Trade.countDocuments()).toBe(60);
      expect((await SyncJob.findOne({ jobId })).retryCount).toBeGreaterThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('ignores duplicate queue deliveries for a finished job', async () => {
    const jobId = await start();
    await h.waitForEvent('sync:completed', { jobId });
    await h.waitForEvent('trades:updated', { jobId }); // last event of a normal run
    const before = h.events.length;
    const job = await h.queue.add('collect', { jobId, seq: 99 }, { jobId: `${jobId}__dup` });
    await vi.waitFor(async () => expect(await job.isCompleted()).toBe(true));
    expect(await Trade.countDocuments()).toBe(60);
    expect(h.events.length).toBe(before); // no extra events were published
  });

  it('reconciles orphaned jobs whose queue entry was lost', async () => {
    const orphan = await SyncJob.create({ jobId: 'sync_orphan', status: 'running', phase: 'awaiting_exchange', startedAt: new Date() });
    await h.lock.acquire('sync_orphan');
    await SyncJob.collection.updateOne({ jobId: 'sync_orphan' }, { $set: { updatedAt: new Date(Date.now() - 3_600_000) } });
    const n = await reconcileOrphanedJobs({ queue: h.queue, lock: h.lock, publisher: h.publisher, logger: h.logger, graceMs: 1000 });
    expect(n).toBe(1);
    expect((await SyncJob.findOne({ jobId: orphan.jobId })).status).toBe('failed');
    expect(await h.lock.owner()).toBeNull();
    await h.waitForEvent('sync:failed', { jobId: 'sync_orphan' });
  });

  it('fails a job whose exchange operation exceeds its deadline', async () => {
    const jobId = await start();
    await h.waitForEvent('sync:started', { jobId });
    await vi.waitFor(async () => expect((await SyncJob.findOne({ jobId })).deadlineAt).toBeTruthy());
    await SyncJob.updateOne({ jobId }, { deadlineAt: new Date(Date.now() - 1000) });
    await h.waitForEvent('sync:failed', { jobId });
    expect((await SyncJob.findOne({ jobId })).errorMessage).toMatch(/deadline/i);
    expect(env.EXCHANGE_OPERATION_TIMEOUT_MS).toBeGreaterThan(env.EXCHANGE_PULL_DELAY_MS);
  });
});
