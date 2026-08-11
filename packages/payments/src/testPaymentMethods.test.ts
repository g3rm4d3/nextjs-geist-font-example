import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEST_PAYMENT_METHOD_ID,
  TEST_PAYMENT_METHODS,
  findTestPaymentMethod,
  isKnownTestPaymentMethod,
} from './testPaymentMethods';

describe('testPaymentMethods', () => {
  it('includes the default test payment method and it succeeds', () => {
    const defaultMethod = findTestPaymentMethod(DEFAULT_TEST_PAYMENT_METHOD_ID);

    expect(defaultMethod).toBeDefined();
    expect(defaultMethod?.outcome).toBe('succeeds');
  });

  it('has unique ids across the catalog', () => {
    const ids = TEST_PAYMENT_METHODS.map((method) => method.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exposes at least one method with each outcome', () => {
    expect(TEST_PAYMENT_METHODS.some((method) => method.outcome === 'succeeds')).toBe(true);
    expect(TEST_PAYMENT_METHODS.some((method) => method.outcome === 'fails')).toBe(true);
  });

  it('isKnownTestPaymentMethod recognizes catalog ids and rejects unknown ones', () => {
    expect(isKnownTestPaymentMethod('pm_card_visa')).toBe(true);
    expect(isKnownTestPaymentMethod('pm_totally_made_up')).toBe(false);
  });

  it('findTestPaymentMethod returns undefined for an unknown id', () => {
    expect(findTestPaymentMethod('pm_totally_made_up')).toBeUndefined();
  });
});
