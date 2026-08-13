import { z } from 'zod';

/**
 * Phase 13: POST .../rating, both directions. "1–5 stars, optional
 * comment" — z.number() (not z.coerce) so a client can't pass "5" and
 * have it silently accepted; stars is always a real number field.
 */
export const submitRatingSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().min(1).max(1000).optional(),
});
export type SubmitRatingInput = z.infer<typeof submitRatingSchema>;
