import crypto from 'node:crypto';
import express from 'express';
import { env } from '../config/env.js';
import { generateTrades } from './tradeGenerator.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ service: 'exchange' });
const FAILURE_MODES = ['none', 'fail', 'malformed'];

/**
 * Mock BSE exchange.
 *  - GET  /getTrades        seeded dataset snapshot, answers immediately.
 *  - POST /pulls            starts an asynchronous "full pull"; 202 immediately.
 *  - GET  /pulls/:id        pending (with retryAfterMs) until the configured delay elapsed,
 *                           then the dataset. Every HTTP exchange is short-lived.
 * Operation state lives in Redis (not in process memory) and readiness is computed from
 * timestamps, so no timers are held and a restarted exchange keeps its operations.
 */
export function createExchangeApp({ redis, config = env }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  const pullKey = (id) => `${config.REDIS_PREFIX}:exchange:pull:${id}`;
  const modeKey = `${config.REDIS_PREFIX}:exchange:mode`;

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'mock-bse-exchange' }));

  app.get('/getTrades', (_req, res) => {
    const trades = generateTrades(config.EXCHANGE_TRADE_COUNT);
    res.json({ count: trades.length, trades });
  });

  app.post('/pulls', async (_req, res, next) => {
    try {
      const mode = (await redis.get(modeKey)) || 'none';
      const operationId = `op_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const now = Date.now();
      const readyAt = now + config.EXCHANGE_PULL_DELAY_MS;
      await redis.multi()
        .hset(pullKey(operationId), { createdAt: now, readyAt, mode, tradeCount: config.EXCHANGE_TRADE_COUNT })
        .expire(pullKey(operationId), 24 * 3600)
        .exec();
      log.info('pull.created', { operationId, readyAt: new Date(readyAt).toISOString(), mode });
      res.status(202).location(`/pulls/${operationId}`).json({
        operationId,
        status: 'pending',
        readyAt: new Date(readyAt).toISOString(),
        retryAfterMs: config.EXCHANGE_PULL_DELAY_MS,
      });
    } catch (err) { next(err); }
  });

  app.get('/pulls/:id', async (req, res, next) => {
    try {
      const op = await redis.hgetall(pullKey(req.params.id));
      if (!op.readyAt) return res.status(404).json({ error: 'Unknown operation' });
      const remaining = Number(op.readyAt) - Date.now();
      if (remaining > 0) {
        res.set('Retry-After', String(Math.ceil(remaining / 1000)));
        return res.json({ operationId: req.params.id, status: 'pending', retryAfterMs: remaining });
      }
      if (op.mode === 'fail') {
        return res.json({ operationId: req.params.id, status: 'failed', error: 'Simulated exchange failure: upstream timeout' });
      }
      let trades = generateTrades(Number(op.tradeCount));
      if (op.mode === 'malformed') {
        // Corrupt every 10th record (10% > MAX_INVALID_RATIO) to exercise validation.
        trades = trades.map((t, i) => (i % 10 === 0 ? { ...t, quantity: -1, price: 'n/a' } : t));
      }
      res.json({ operationId: req.params.id, status: 'completed', count: trades.length, trades });
    } catch (err) { next(err); }
  });

  // Development-only switch used by the demo/tests to make the *next* pulls fail or return bad data.
  app.post('/admin/mode', async (req, res, next) => {
    try {
      if (config.NODE_ENV === 'production') return res.status(404).json({ error: 'Not found' });
      const mode = req.body?.mode;
      if (!FAILURE_MODES.includes(mode)) return res.status(400).json({ error: `mode must be one of ${FAILURE_MODES.join(', ')}` });
      await redis.set(modeKey, mode);
      res.json({ mode });
    } catch (err) { next(err); }
  });

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err, _req, res, _next) => {
    log.error('exchange.error', { err });
    res.status(500).json({ error: 'Exchange internal error' });
  });
  return app;
}
