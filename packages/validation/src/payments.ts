import { z } from 'zod';

/**
 * Phase 11: PATCH /passengers/me/payment-method. Shape-only validation —
 * whether the id is actually one of Stripe's documented TEST MODE
 * payment methods (@rideshare/payments's TEST_PAYMENT_METHODS) is a
 * business rule checked server-side in paymentService, the same split
 * ride.ts uses for idempotencyKey.
 */
export const updatePaymentMethodSchema = z.object({
  testPaymentMethodId: z.string().trim().min(1).max(100),
});
export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodSchema>;
