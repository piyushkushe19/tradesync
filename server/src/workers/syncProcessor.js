import { UnrecoverableError } from 'bullmq';
import { SyncJob, ACTIVE_STATUSES, TERMINAL_STATUSES } from '../models/SyncJob.js';
import { Trade } from '../models/Trade.js';
import { validateTrades, upsertTrades } from '../services/tradeIngest.js';
import { serializeJob } from '../utils/serialize.js';

const MAX_CHECK_DELAY_MS = 5 * 60 * 1000;
const MIN_CHECK_DELAY_MS = 1000;
const READY_MARGIN_MS = 250;
const activeFilter = (jobId) => ({ jobId, status: { $in: ACTIVE_STATUSES } });

/**
 * Two BullMQ job types drive one synchronization (one SyncJob document):
 *   initiate -> POST /pulls on the exchange, store operationId, schedule a DELAYED `collect` job
 *   collect  -> GET /pulls/:id. Pending? schedule another delayed collect (delay = exchange's
 *               retryAfterMs, so normally exactly one check at completion). Ready? validate,
 *               bulk upsert, mark completed, release lock, publish events.
 * No worker slot, HTTP connection or timer is held during the (up to 15 minute) exchange wait:
 * the waiting happens as a delayed job in Redis.
 */
export function createSyncProcessor({ queue, lock, publisher, exchange, config, logger }) {
  async function emit(type, jobDoc, extra = {}) {
    try {
      await publisher.publish(type, { jobId: jobDoc.jobId, status: jobDoc.status, job: serializeJob(jobDoc), ...extra });
    } catch (err) {
      // State is already persisted; clients recover via REST reconciliation.
      logger.warn('event.publish_failed', { jobId: jobDoc.jobId, type, err });
    }
  }

  async function scheduleCollect(jobId, seq, delayMs) {
    const delay = Math.min(MAX_CHECK_DELAY_MS, Math.max(MIN_CHECK_DELAY_MS, delayMs));
    await queue.add('collect', { jobId, seq }, { jobId: `${jobId}__collect_${seq}`, delay });
    return delay;
  }

  async function initiate(data, bullJob, log) {
    let sync = await SyncJob.findOne({ jobId: data.jobId });
    if (!sync) throw new UnrecoverableError(`SyncJob ${data.jobId} not found`);
    if (TERMINAL_STATUSES.includes(sync.status)) return { skipped: 'terminal' }; // duplicate delivery

    const wasQueued = sync.status === 'queued';
    const set = { status: 'running', phase: 'starting_exchange_pull', retryCount: bullJob.attemptsMade };
    if (!sync.startedAt) set.startedAt = new Date();
    sync = await SyncJob.findOneAndUpdate(activeFilter(data.jobId), { $set: set }, { new: true });
    if (!sync) return { skipped: 'terminal' };
    if (wasQueued) await emit('sync:started', sync);

    if (!sync.exchangeOperationId) { // idempotent on retry: reuse an already-created pull
      const pull = await exchange.createPull();
      sync = await SyncJob.findOneAndUpdate(
        activeFilter(data.jobId),
        { $set: { exchangeOperationId: pull.operationId, exchangeReadyAt: new Date(pull.readyAt), deadlineAt: new Date(Date.now() + config.EXCHANGE_OPERATION_TIMEOUT_MS), phase: 'awaiting_exchange' } },
        { new: true },
      );
      if (!sync) return { skipped: 'terminal' };
      log.info('exchange.pull_created', { operationId: pull.operationId, readyAt: pull.readyAt });
    }

    const delay = await scheduleCollect(data.jobId, 1, Math.max(0, sync.exchangeReadyAt - Date.now()) + READY_MARGIN_MS);
    await emit('sync:progress', sync, { phase: 'awaiting_exchange', message: 'Exchange pull in progress', nextCheckInMs: delay });
    return { scheduledCollectInMs: delay };
  }

  async function collect(data, _bullJob, log) {
    let sync = await SyncJob.findOne({ jobId: data.jobId });
    if (!sync) throw new UnrecoverableError(`SyncJob ${data.jobId} not found`);
    if (TERMINAL_STATUSES.includes(sync.status)) return { skipped: 'terminal' };
    if (!sync.exchangeOperationId) throw new UnrecoverableError('Job has no exchange operation id');
    if (sync.deadlineAt && Date.now() > sync.deadlineAt.getTime()) {
      throw new UnrecoverableError('Exchange operation exceeded its allowed deadline');
    }

    const result = await exchange.getPull(sync.exchangeOperationId);

    if (result.status === 'pending') {
      const delay = await scheduleCollect(data.jobId, data.seq + 1, (result.retryAfterMs ?? 0) + READY_MARGIN_MS);
      log.info('exchange.still_pending', { nextCheckInMs: delay });
      return { pending: true };
    }
    if (result.status === 'failed') throw new UnrecoverableError(`Exchange pull failed: ${result.error || 'unknown error'}`);
    if (result.status !== 'completed') throw new UnrecoverableError(`Unexpected exchange status "${result.status}"`);

    // ---- validate everything BEFORE writing anything ----
    const { valid, rejected } = validateTrades(result.trades);
    const total = (result.trades?.length ?? 0);
    if (total === 0 || rejected / total > config.MAX_INVALID_RATIO) {
      throw new UnrecoverableError(`Exchange returned malformed data (${rejected} of ${total} records invalid)`);
    }

    sync = await SyncJob.findOneAndUpdate(
      activeFilter(data.jobId),
      { $set: { phase: 'persisting', expectedTradeCount: valid.length, rejectedTradeCount: rejected, processedTradeCount: 0 } },
      { new: true },
    );
    if (!sync) return { skipped: 'terminal' };
    await emit('sync:progress', sync, { phase: 'persisting', message: `Persisting ${valid.length} trades` });

    const counts = await upsertTrades(valid, {
      chunkSize: config.BULK_CHUNK_SIZE,
      onChunk: async ({ processed }) => {
        const updated = await SyncJob.findOneAndUpdate(activeFilter(data.jobId), { $set: { processedTradeCount: processed } }, { new: true });
        if (updated && processed < valid.length) await emit('sync:progress', updated, { phase: 'persisting' });
      },
    });

    // ---- all writes succeeded: only now may the job become `completed` ----
    const now = new Date();
    const done = await SyncJob.findOneAndUpdate(
      activeFilter(data.jobId),
      { $set: { status: 'completed', phase: 'completed', completedAt: now, durationMs: now - sync.startedAt, processedTradeCount: counts.processed, insertedTradeCount: counts.upserted, updatedTradeCount: counts.matched, errorMessage: null } },
      { new: true },
    );
    if (!done) return { skipped: 'terminal' };
    await lock.release(data.jobId).catch((err) => log.warn('lock.release_failed', { err }));
    log.info('sync.completed', { inserted: counts.upserted, updated: counts.matched, rejected, durationMs: done.durationMs });
    await emit('sync:completed', done);
    const totalTrades = await Trade.estimatedDocumentCount().catch(() => undefined);
    await emit('trades:updated', done, { insertedTradeCount: counts.upserted, updatedTradeCount: counts.matched, totalTrades });
    return { completed: true };
  }

  async function failJob(jobId, err, log) {
    const current = await SyncJob.findOne(activeFilter(jobId));
    const now = new Date();
    const failed = current && await SyncJob.findOneAndUpdate(
      activeFilter(jobId),
      { $set: { status: 'failed', phase: 'failed', completedAt: now, errorMessage: String(err.message).slice(0, 500), durationMs: now - (current.startedAt ?? current.createdAt) } },
      { new: true },
    );
    await lock.release(jobId).catch((e) => log.warn('lock.release_failed', { err: e }));
    if (failed) {
      log.error('sync.failed', { err });
      await emit('sync:failed', failed, { error: failed.errorMessage });
    }
  }

  return async function process(bullJob) {
    const { jobId } = bullJob.data;
    const log = logger.child({ jobId, bullJobId: bullJob.id, step: bullJob.name, attempt: bullJob.attemptsMade + 1 });
    try {
      if (bullJob.name === 'initiate') return await initiate(bullJob.data, bullJob, log);
      if (bullJob.name === 'collect') return await collect(bullJob.data, bullJob, log);
      throw new UnrecoverableError(`Unknown job name ${bullJob.name}`);
    } catch (err) {
      const unrecoverable = err instanceof UnrecoverableError || err.retryable === false;
      const finalAttempt = bullJob.attemptsMade + 1 >= (bullJob.opts.attempts ?? 1);
      if (unrecoverable || finalAttempt) {
        await failJob(jobId, err, log);
        throw err instanceof UnrecoverableError ? err : new UnrecoverableError(err.message);
      }
      log.warn('sync.attempt_failed_will_retry', { err });
      const retrying = await SyncJob.findOneAndUpdate(activeFilter(jobId), { $set: { retryCount: bullJob.attemptsMade + 1, errorMessage: `Retrying after error: ${String(err.message).slice(0, 300)}` } }, { new: true });
      if (retrying) await emit('sync:progress', retrying, { phase: 'retrying', message: 'Temporary error, retrying' });
      throw err; // BullMQ re-delivers with exponential backoff
    }
  };
}

/** Marks active SyncJobs that no longer have any BullMQ job behind them as failed (e.g. Redis was flushed). */
export async function reconcileOrphanedJobs({ queue, lock, publisher, logger, graceMs = 60_000 }) {
  const live = await queue.getJobs(['waiting', 'delayed', 'active', 'prioritized', 'waiting-children']);
  const liveIds = new Set(live.map((j) => j.data?.jobId));
  const cutoff = new Date(Date.now() - graceMs);
  const candidates = await SyncJob.find({ status: { $in: ACTIVE_STATUSES }, updatedAt: { $lt: cutoff } });
  let reconciled = 0;
  for (const c of candidates) {
    if (liveIds.has(c.jobId)) continue;
    const now = new Date();
    const failed = await SyncJob.findOneAndUpdate(
      activeFilter(c.jobId),
      { $set: { status: 'failed', phase: 'failed', completedAt: now, durationMs: now - (c.startedAt ?? c.createdAt), errorMessage: 'Job was interrupted and its queue entry was lost; please start a new sync' } },
      { new: true },
    );
    if (!failed) continue;
    reconciled += 1;
    await lock.release(c.jobId).catch(() => {});
    logger.warn('sync.orphan_reconciled', { jobId: c.jobId });
    await publisher.publish('sync:failed', { jobId: c.jobId, status: 'failed', job: serializeJob(failed), error: failed.errorMessage }).catch(() => {});
  }
  return reconciled;
}
