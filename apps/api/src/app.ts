import cors from 'cors';
import express, { type Express, type Request } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestIdMiddleware } from './middleware/requestId';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { driversRouter } from './routes/drivers';
import { healthRouter } from './routes/health';
import { passengersRouter } from './routes/passengers';

/**
 * Builds the Express application without starting a listener, so tests can
 * exercise it directly with supertest instead of binding a real port.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ALLOWED_ORIGINS }));
  app.use(express.json({ limit: '1mb' }));
  app.use(requestIdMiddleware);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req: Request) => req.requestId,
      autoLogging: env.NODE_ENV !== 'test',
    }),
  );

  app.use(healthRouter);
  app.use(authRouter);
  app.use(passengersRouter);
  app.use(driversRouter);
  app.use(adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
