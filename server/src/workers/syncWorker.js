import { Worker } from 'bullmq';
import { QUEUE_NAME } from '../queues/syncQueue.js';

export function createSyncWorker({ connection, processor, concurrency, prefix, logger }) {
  const worker = new Worker(QUEUE_NAME, processor, {
    connection,
    prefix: `${prefix}:bull`,
    concurrency, // bounded: at most N jobs in flight per worker process
    lockDuration: 60_000,
  });
  worker.on('error', (err) => logger.error('worker.error', { err }));
  worker.on('stalled', (jobId) => logger.warn('worker.job_stalled', { bullJobId: jobId }));
  worker.on('failed', (job, err) => logger.warn('worker.job_failed', { bullJobId: job?.id, err }));
  worker.on('completed', (job) => logger.debug('worker.job_completed', { bullJobId: job.id }));
  return worker;
}
