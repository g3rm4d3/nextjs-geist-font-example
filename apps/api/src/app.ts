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
import { driverEarningsRouter } from './routes/driverEarnings';
import { driverOffersRouter } from './routes/driverOffers';
import { driverRidesRouter } from './routes/driverRides';
import { driversRouter } from './routes/drivers';
import { healthRouter } from './routes/health';
import { passengersRouter } from './routes/passengers';
import { paymentsRouter } from './routes/payments';
import { pricingRouter } from './routes/pricing';
import { ridesRouter } from './routes/rides';
import { routePreviewRouter } from './routes/routePreview';
import { webhooksRouter } from './routes/webhooks';

/**
 * Builds the Express application without starting a listener, so tests can
 * exercise it directly with supertest instead of binding a real port.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ALLOWED_ORIGINS }));
  app.use(requestIdMiddleware);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req: Request) => req.requestId,
      autoLogging: env.NODE_ENV !== 'test',
    }),
  );

  // Mounted BEFORE the global express.json() body parser: Stripe signs
  // the exact raw request body bytes (see routes/webhooks.ts), so this
  // route must receive the body before anything parses/re-serializes it.
  // Placed after requestIdMiddleware/pinoHttp above (not before) so
  // webhook requests still get a requestId and get logged like every
  // other request.
  app.use(webhooksRouter);

  app.use(express.json({ limit: '1mb' }));

  app.use(healthRouter);
  app.use(authRouter);
  app.use(passengersRouter);
  app.use(driversRouter);
  app.use(driverOffersRouter);
  app.use(driverRidesRouter);
  app.use(driverEarningsRouter);
  app.use(adminRouter);
  app.use(routePreviewRouter);
  app.use(pricingRouter);
  app.use(ridesRouter);
  app.use(paymentsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
