export interface TestPaymentMethod {
  id: string;
  label: string;
  outcome: 'succeeds' | 'fails';
  description: string;
}

/**
 * Stripe's own publicly-documented TEST MODE payment method ids
 * (https://stripe.com/docs/testing). These are safe, non-sensitive,
 * well-known constants designed by Stripe specifically for testing
 * without real cards — not real card data, and not secrets. Both the
 * MOCK and real Stripe TEST MODE providers give these exact ids the
 * exact outcomes documented here, so the confirmation behavior a caller
 * observes does not change when swapping providers.
 */
export const TEST_PAYMENT_METHODS: readonly TestPaymentMethod[] = [
  {
    id: 'pm_card_visa',
    label: 'Visa •••• 4242 (test)',
    outcome: 'succeeds',
    description: "Always succeeds — Stripe's standard successful test card.",
  },
  {
    id: 'pm_card_chargeDeclined',
    label: 'Declined card (test)',
    outcome: 'fails',
    description: 'Always declines with a generic decline reason.',
  },
  {
    id: 'pm_card_chargeDeclinedInsufficientFunds',
    label: 'Insufficient funds (test)',
    outcome: 'fails',
    description: 'Always declines: insufficient funds.',
  },
  {
    id: 'pm_card_chargeDeclinedExpiredCard',
    label: 'Expired card (test)',
    outcome: 'fails',
    description: 'Always declines: expired card.',
  },
  {
    id: 'pm_card_chargeDeclinedProcessingError',
    label: 'Processing error (test)',
    outcome: 'fails',
    description: 'Always declines: a generic processing error occurred.',
  },
] as const;

/** Used when a passenger has never chosen a test payment method. */
export const DEFAULT_TEST_PAYMENT_METHOD_ID = 'pm_card_visa';

export function findTestPaymentMethod(id: string): TestPaymentMethod | undefined {
  return TEST_PAYMENT_METHODS.find((method) => method.id === id);
}

export function isKnownTestPaymentMethod(id: string): boolean {
  return findTestPaymentMethod(id) !== undefined;
}
