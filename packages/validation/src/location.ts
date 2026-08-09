import { z } from 'zod';
import { coordinateSchema } from './routes';

/**
 * Section 6/Phase 6: a driver's location ping. latitude/longitude reuse
 * the same bounds as coordinateSchema (routes.ts); heading, speed,
 * accuracy, and timestamp are all optional, per the spec's "driver
 * location payload MAY include" wording. A client that can't provide
 * heading/speed/accuracy (e.g. a coarse fix) can still send a valid ping.
 */
export const driverLocationPingSchema = coordinateSchema.extend({
  /** Degrees clockwise from true north, 0-360. */
  heading: z.number().min(0).max(360).optional(),
  /** Meters per second. */
  speed: z.number().min(0).optional(),
  /** Meters — the GPS fix's estimated horizontal accuracy radius. */
  accuracy: z.number().min(0).optional(),
  /** ISO 8601. Missing timestamp defaults to server-received time — see
   * apps/api's locationService for why this isn't just "always required". */
  timestamp: z.iso.datetime().optional(),
});
export type DriverLocationPingInput = z.infer<typeof driverLocationPingSchema>;
