import crypto from 'node:crypto';
import { SyncJob, ACTIVE_STATUSES } from '../models/SyncJob.js';
import { ConflictError, ServiceUnavailableError } from '../utils/errors.js';
import { serializeJob } from '../utils/serialize.js';

export function createSyncService({ queue, lock, publisher, logger }) {
  return {
    /**
     * Accepts a sync request. Does only O(1) work (lock + one insert + one enqueue) and never
     * talks to the exchange, so the HTTP request finishes in milliseconds.
     */
    async requestSync() {
      const jobId = `sync_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
      let acquired;
      try {
        acquired = await lock.acquire(jobId);
      } catch (err) {
        logger.error('sync.lock_unavailable', { err });
        throw new ServiceUnavailableError();
      }
      if (!acquired) {
        // The lock value IS the owning jobId, so it is correct even before the winner's SyncJob row exists.
        const activeJobId = (await lock.owner().catch(() => null))
          ?? (await SyncJob.findOne({ status: { $in: ACTIVE_STATUSES } }).sort({ createdAt: -1 }).lean())?.jobId
          ?? null;
        throw new ConflictError('A synchronization is already in progress', { activeJobId });
      }

      let doc;
      try {
        doc = await SyncJob.create({ jobId, status: 'queued', phase: 'queued' });
        await queue.add('initiate', { jobId }, { jobId: `${jobId}__initiate` });
      } catch (err) {
        // Roll back so the system is never stuck behind a lock with no job behind it.
        if (doc) await SyncJob.updateOne({ jobId }, { status: 'failed', phase: 'failed', errorMessage: 'Could not enqueue job', completedAt: new Date() }).catch(() => {});
        await lock.release(jobId).catch(() => {});
        logger.error('sync.enqueue_failed', { jobId, err });
        throw new ServiceUnavailableError();
      }

      logger.info('sync.queued', { jobId });
      const job = serializeJob(doc);
      try {
        await publisher.publish('sync:queued', { jobId, status: 'queued', job });
      } catch (err) {
        logger.warn('sync.event_publish_failed', { jobId, err }); // best effort; clients reconcile via REST
      }
      return job;
    },

    async getStatus() {
      const [active, latest, lastSuccessful] = await Promise.all([
        SyncJob.findOne({ status: { $in: ACTIVE_STATUSES } }).sort({ createdAt: -1 }),
        SyncJob.findOne().sort({ createdAt: -1 }),
        SyncJob.findOne({ status: 'completed' }).sort({ completedAt: -1 }),
      ]);
      return { active: serializeJob(active), latest: serializeJob(latest), lastSuccessful: serializeJob(lastSuccessful) };
    },

    async listJobs({ page, limit }) {
      const [docs, total] = await Promise.all([
        SyncJob.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
        SyncJob.countDocuments(),
      ]);
      return { items: docs.map(serializeJob), total };
    },
  };
}
