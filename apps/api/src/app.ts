import cors from 'cors';
import express, { type Express, type Request } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestIdMiddleware } from './middleware/requestId';
import { adminRouter } from './routes/admin';
import { adminAuditLogsRouter } from './routes/adminAuditLogs';
import { adminDashboardRouter } from './routes/adminDashboard';
import { adminDocumentsRouter } from './routes/adminDocuments';
import { adminDriversRouter } from './routes/adminDrivers';
import { adminEarningsRouter } from './routes/adminEarnings';
import { adminPassengersRouter } from './routes/adminPassengers';
import { adminPaymentsRouter } from './routes/adminPayments';
import { adminPricingRouter } from './routes/adminPricing';
import { adminRatingsRouter } from './routes/adminRatings';
import { adminRidesRouter } from './routes/adminRides';
import { adminSettingsRouter } from './routes/adminSettings';
import { adminSupportRouter } from './routes/adminSupport';
import { adminVehiclesRouter } from './routes/adminVehicles';
import { authRouter } from './routes/auth';
import { driverDocumentsRouter } from './routes/driverDocuments';
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

  // Phase 15's document upload sends file bytes as base64 JSON (see
  // uploadDocumentSchema's own 6MB base64-string ceiling) — bumped from
  // the original 1mb default to comfortably fit a photographed license/
  // insurance document, which every other route's much smaller payloads
  // don't need.
  app.use(express.json({ limit: '8mb' }));

  app.use(healthRouter);
  app.use(authRouter);
  app.use(passengersRouter);
  app.use(driversRouter);
  app.use(driverOffersRouter);
  app.use(driverRidesRouter);
  app.use(driverEarningsRouter);
  app.use(driverDocumentsRouter);
  // adminRouter (Phase 6/10/12) owns some literal /admin/... paths that
  // would otherwise collide with these routers' /admin/rides/:id-shaped
  // params (Express matches route-registration order) — mounted first
  // so e.g. /admin/rides/active is never swallowed by /admin/rides/:id.
  app.use(adminRouter);
  app.use(adminDriversRouter);
  app.use(adminDocumentsRouter);
  app.use(adminVehiclesRouter);
  app.use(adminPassengersRouter);
  app.use(adminRidesRouter);
  app.use(adminPaymentsRouter);
  app.use(adminRatingsRouter);
  app.use(adminSupportRouter);
  app.use(adminPricingRouter);
  app.use(adminSettingsRouter);
  app.use(adminDashboardRouter);
  app.use(adminEarningsRouter);
  app.use(adminAuditLogsRouter);
  app.use(routePreviewRouter);
  app.use(pricingRouter);
  app.use(ridesRouter);
  app.use(paymentsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
