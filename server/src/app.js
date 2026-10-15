import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import { createRoutes } from './routes/index.js';
import { createErrorHandler, notFound } from './middleware/errorHandler.js';

export function createApp({ hub, redis, syncService, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple'); // no qs nesting => no ?price[$gt]=0 operator injection
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_URL.split(',').map((s) => s.trim()), methods: ['GET', 'POST'], maxAge: 600 }));
  app.use(express.json({ limit: '10kb' }));
  app.use('/api', createRoutes({ hub, redis, syncService, logger }));
  app.use(notFound);
  app.use(createErrorHandler(logger));
  return app;
}
