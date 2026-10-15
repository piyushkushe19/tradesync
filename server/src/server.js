import http from 'node:http';
import { env } from './config/env.js';
import { connectMongo, disconnectMongo } from './config/db.js';
import { createApiRedis } from './config/redis.js';
import { createLogger } from './utils/logger.js';
import { createSyncQueue } from './queues/syncQueue.js';
import { createEventPublisher, subscribeEvents } from './events/eventBus.js';
import { SseHub } from './events/sseHub.js';
import { createSyncLock } from './services/syncLock.js';
import { createSyncService } from './services/syncService.js';
import { createApp } from './app.js';

const logger = createLogger({ service: 'api' });

async function main() {
  await connectMongo(logger);
  const redis = createApiRedis(logger);
  const subscriber = redis.duplicate({ maxRetriesPerRequest: null });
  subscriber.on('error', (err) => logger.error('redis.subscriber_error', { err }));

  const queue = createSyncQueue(redis);
  const publisher = createEventPublisher(redis, env.REDIS_PREFIX);
  const lock = createSyncLock(redis, env.REDIS_PREFIX, env.EXCHANGE_OPERATION_TIMEOUT_MS + 5 * 60_000);
  const hub = new SseHub({ heartbeatMs: env.SSE_HEARTBEAT_MS, maxClients: env.MAX_SSE_CLIENTS, logger });
  const syncService = createSyncService({ queue, lock, publisher, logger });

  await subscribeEvents(subscriber, env.REDIS_PREFIX, {
    onEvent: (evt) => hub.broadcast(evt),
    onResync: () => hub.broadcastResync(),
  });

  const server = http.createServer(createApp({ hub, redis, syncService, logger }));
  server.listen(env.PORT, () => logger.info('api.listening', { port: env.PORT }));

  let closing = false;
  async function shutdown(signal) {
    if (closing) return;
    closing = true;
    logger.info('api.shutdown', { signal });
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    hub.closeAll(); // end SSE streams so server.close() can finish; browsers auto-reconnect
    server.close(async () => {
      await queue.close().catch(() => {});
      await Promise.allSettled([redis.quit(), subscriber.quit()]);
      await disconnectMongo().catch(() => {});
      process.exit(0);
    });
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('api.fatal', { err });
  process.exit(1);
});
