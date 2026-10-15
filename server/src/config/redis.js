import IORedis from 'ioredis';
import { env } from './env.js';

/**
 * Failing fast (few retries per request) keeps API requests from hanging when Redis
 * is down: they surface as 503 instead of waiting past the 30s network cut-off.
 */
export function createApiRedis(logger) {
  const client = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: 2,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
  client.on('error', (err) => logger?.error('redis.error', { err }));
  return client;
}

/** BullMQ workers require maxRetriesPerRequest = null (blocking commands). */
export function createWorkerRedis(logger) {
  const client = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  client.on('error', (err) => logger?.error('redis.error', { err }));
  return client;
}
