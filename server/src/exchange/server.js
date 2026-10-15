import { env } from '../config/env.js';
import { createApiRedis } from '../config/redis.js';
import { createLogger } from '../utils/logger.js';
import { createExchangeApp } from './app.js';

const log = createLogger({ service: 'exchange' });
const redis = createApiRedis(log);
const server = createExchangeApp({ redis }).listen(env.EXCHANGE_PORT, () =>
  log.info('exchange.listening', {
    port: env.EXCHANGE_PORT,
    pullDelayMs: env.EXCHANGE_PULL_DELAY_MS,
    tradeCount: env.EXCHANGE_TRADE_COUNT,
  }),
);

async function shutdown(signal) {
  log.info('exchange.shutdown', { signal });
  server.close(async () => { await redis.quit().catch(() => {}); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
