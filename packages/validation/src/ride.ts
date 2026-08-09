import { z } from 'zod';
import { coordinateSchema } from './routes';

const namedLocationSchema = z.object({
  coordinate: coordinateSchema,
  label: z.string().trim().min(1).max(200),
});

/**
 * Section 7: POST /rides. Deliberately no fare/estimate field anywhere
 * in this schema — the server always recomputes both from
 * pickup/destination (see apps/api's rideService), never accepts them
 * from the client (section 3).
 *
 * idempotencyKey is required, not optional: the whole point is a client
 * generates one per request attempt and resends the *same* value on
 * retry, so making it optional would let a client silently opt out of
 * the protection it exists to provide.
 */
export const createRideRequestSchema = z.object({
  pickup: namedLocationSchema,
  destination: namedLocationSchema,
  idempotencyKey: z.string().trim().min(1).max(100),
});
export type CreateRideRequestInput = z.infer<typeof createRideRequestSchema>;
