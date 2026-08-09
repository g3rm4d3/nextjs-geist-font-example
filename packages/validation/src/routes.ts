import { z } from 'zod';

/**
 * Same lat/lng ranges as the database's CHECK constraints on `rides`
 * (packages/database/src/schema/rides.ts) — keep them in sync.
 */
export const coordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type CoordinateInput = z.infer<typeof coordinateSchema>;

export const routePreviewSchema = z.object({
  origin: coordinateSchema,
  destination: coordinateSchema,
});
export type RoutePreviewInput = z.infer<typeof routePreviewSchema>;
