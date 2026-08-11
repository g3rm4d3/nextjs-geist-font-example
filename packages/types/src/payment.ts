/**
 * Payment API contract for a ride's payment attempt (Phase 11), shared
 * by apps/api (producer) and passenger-app (consumer). Mirrors
 * @rideshare/database's payment_records row by hand rather than
 * importing it — this package stays dependency-free on purpose (see
 * docs/architecture.md). Provider-safe only: no field here ever carries
 * raw card information, only opaque provider references.
 */
export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';

export interface Payment {
  id: string;
  rideId: string;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  failureReason: string | null;
  refundedAt: string | null;
  refundReason: string | null;
  createdAt: string;
}

/**
 * One of Stripe's own publicly-documented TEST MODE payment method ids
 * (see @rideshare/payments's TEST_PAYMENT_METHODS, the source of truth —
 * this mirrors its shape by hand for the same dependency-free reason as
 * everything else in this file). Served to clients via
 * GET /payments/test-methods so PaymentMethodsScreen doesn't hardcode a
 * duplicate copy of the catalog.
 */
export interface TestPaymentMethodSummary {
  id: string;
  label: string;
  outcome: 'succeeds' | 'fails';
  description: string;
}
