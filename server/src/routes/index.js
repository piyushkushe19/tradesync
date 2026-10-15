import { Router } from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { tradesController } from '../controllers/tradesController.js';
import { createSyncController } from '../controllers/syncController.js';
import { createEventsController } from '../controllers/eventsController.js';
import { validateQuery, tradesQuerySchema, jobsQuerySchema, emptyQuerySchema } from '../middleware/validate.js';

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const limiter = (windowMs, limit) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } },
  });

export function createRoutes({ hub, redis, syncService, logger }) {
  const router = Router();
  const syncController = createSyncController({ syncService });
  const eventsController = createEventsController({ hub, redis, prefix: env.REDIS_PREFIX, logger });

  router.get('/health', asyncHandler(async (_req, res) => {
    const mongo = mongoose.connection.readyState === 1;
    const redisOk = await redis.ping().then((r) => r === 'PONG').catch(() => false);
    const ok = mongo && redisOk;
    res.status(ok ? 200 : 503).json({ success: ok, data: { status: ok ? 'ok' : 'degraded', mongo, redis: redisOk, sseClients: hub.size } });
  }));

  // SSE is a long-lived connection: it is deliberately not subject to the request rate limiter.
  router.get('/events', validateQuery(emptyQuerySchema), eventsController);

  router.use(limiter(60_000, 300));
  router.get('/trades/stats', validateQuery(emptyQuerySchema), asyncHandler(tradesController.stats));
  router.get('/trades', validateQuery(tradesQuerySchema), asyncHandler(tradesController.list));
  router.post('/sync', limiter(60_000, 10), asyncHandler(syncController.start));
  router.get('/sync/status', validateQuery(emptyQuerySchema), asyncHandler(syncController.status));
  router.get('/sync/jobs', validateQuery(jobsQuerySchema), asyncHandler(syncController.jobs));
  return router;
}
