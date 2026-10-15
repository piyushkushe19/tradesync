// Runs before every test file: point everything at isolated test resources.
const mongo = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/tradesync_test';
const redis = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379/15';

if (!/test/i.test(mongo.split('/').pop())) {
  throw new Error(`Refusing to run tests: database name in "${mongo}" must contain "test"`);
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  MONGODB_URI: mongo,
  REDIS_URL: redis,
  REDIS_PREFIX: 'tradesync_test',
  EXCHANGE_PULL_DELAY_MS: '400',
  EXCHANGE_TRADE_COUNT: '60',
  EXCHANGE_OPERATION_TIMEOUT_MS: '20000',
  EXCHANGE_HTTP_TIMEOUT_MS: '5000',
  JOB_ATTEMPTS: '2',
  JOB_BACKOFF_MS: '100',
  WORKER_CONCURRENCY: '2',
  BULK_CHUNK_SIZE: '25',
  SSE_HEARTBEAT_MS: '1000',
});
