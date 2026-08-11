import { pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './_helpers';
import { users } from './users';

/** 1:1 extension of a users row with role = 'PASSENGER'. */
export const passengerProfiles = pgTable(
  'passenger_profiles',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    // Which of Stripe's TEST MODE payment method ids (Phase 11) to charge
    // by default on ride completion. Null until the passenger picks one;
    // callers fall back to DEFAULT_TEST_PAYMENT_METHOD_ID from
    // @rideshare/payments in that case.
    defaultTestPaymentMethodId: text('default_test_payment_method_id'),
    ...timestamps,
  },
  (table) => [uniqueIndex('passenger_profiles_user_id_key').on(table.userId)],
);
