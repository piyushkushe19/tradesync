import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
// Single root-level .env shared by API, worker and exchange. Real env vars win.
dotenv.config({ path: path.resolve(here, '../../../.env') });

const int = (def, min, max) => z.coerce.number().int().min(min).max(max).default(def);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    PORT: int(4000, 1, 65535),
    CLIENT_URL: z.string().min(1).default('http://localhost:5173'),
    SSE_HEARTBEAT_MS: int(15000, 1000, 120000),
    MAX_SSE_CLIENTS: int(500, 1, 100000),
    MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://'),
    REDIS_URL: z.string().regex(/^rediss?:\/\//, 'must start with redis:// or rediss://'),
    REDIS_PREFIX: z.string().regex(/^[A-Za-z0-9_-]+$/).default('tradesync'),
    EXCHANGE_PORT: int(4100, 1, 65535),
    EXCHANGE_URL: z.string().url().default('http://127.0.0.1:4100'),
    EXCHANGE_PULL_DELAY_MS: int(10000, 0, 3_600_000),
    EXCHANGE_TRADE_COUNT: int(5000, 1, 200000),
    EXCHANGE_OPERATION_TIMEOUT_MS: int(1_200_000, 1000, 7_200_000),
    EXCHANGE_HTTP_TIMEOUT_MS: int(20000, 500, 29000), // must stay below the 30s network cut-off
    JOB_ATTEMPTS: int(3, 1, 10),
    JOB_BACKOFF_MS: int(2000, 10, 600000),
    WORKER_CONCURRENCY: int(2, 1, 32),
    BULK_CHUNK_SIZE: int(1000, 10, 10000),
    MAX_INVALID_RATIO: z.coerce.number().min(0).max(1).default(0.05),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.EXCHANGE_OPERATION_TIMEOUT_MS <= cfg.EXCHANGE_PULL_DELAY_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EXCHANGE_OPERATION_TIMEOUT_MS'],
        message: 'must be greater than EXCHANGE_PULL_DELAY_MS or every pull would time out',
      });
    }
  });

export function parseEnv(source = process.env) {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return Object.freeze(result.data);
}

export const env = parseEnv();
