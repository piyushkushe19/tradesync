import { env } from './config/env.js';
import { connectMongo, disconnectMongo } from './config/db.js';
import { createApiRedis, createWorkerRedis } from './config/redis.js';
import { createLogger } from './utils/logger.js';
import { createSyncQueue } from './queues/syncQueue.js';
import { createEventPublisher } from './events/eventBus.js';
import { createSyncLock } from './services/syncLock.js';
import { createExchangeClient } from './services/exchangeClient.js';
import { createSyncProcessor, reconcileOrphanedJobs } from './workers/syncProcessor.js';
import { createSyncWorker } from './workers/syncWorker.js';

const logger = createLogger({ service: 'worker' });

async function main() {
  await connectMongo(logger);
  const commandRedis = createApiRedis(logger);
  const workerRedis = createWorkerRedis(logger);
  const queue = createSyncQueue(commandRedis);
  const publisher = createEventPublisher(commandRedis, env.REDIS_PREFIX);
  const lock = createSyncLock(commandRedis, env.REDIS_PREFIX, env.EXCHANGE_OPERATION_TIMEOUT_MS + 5 * 60_000);
  const processor = createSyncProcessor({ queue, lock, publisher, exchange: createExchangeClient(), config: env, logger });

  const reconciled = await reconcileOrphanedJobs({ queue, lock, publisher, logger });
  const worker = createSyncWorker({ connection: workerRedis, processor, concurrency: env.WORKER_CONCURRENCY, prefix: env.REDIS_PREFIX, logger });
  await worker.waitUntilReady();
  logger.info('worker.ready', { concurrency: env.WORKER_CONCURRENCY, reconciledOrphans: reconciled });

  let closing = false;
  async function shutdown(signal) {
    if (closing) return;
    closing = true;
    logger.info('worker.shutdown', { signal });
    const force = setTimeout(() => process.exit(1), 30_000);
    force.unref();
    try {
      await worker.close(); // waits for in-flight jobs; unfinished jobs are re-delivered after restart
      await queue.close();
      await Promise.allSettled([commandRedis.quit(), workerRedis.quit()]);
      await disconnectMongo();
    } finally {
      process.exit(0);
    }
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('worker.fatal', { err });
  process.exit(1);
});
