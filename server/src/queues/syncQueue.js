import { Queue } from 'bullmq';
import { env } from '../config/env.js';

export const QUEUE_NAME = 'trade-sync';

export const defaultJobOptions = {
  attempts: env.JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: env.JOB_BACKOFF_MS },
  removeOnComplete: { age: 3600, count: 200 },
  removeOnFail: { age: 7 * 24 * 3600, count: 500 },
};

export function createSyncQueue(connection, prefix = env.REDIS_PREFIX) {
  return new Queue(QUEUE_NAME, { connection, prefix: `${prefix}:bull`, defaultJobOptions });
}
