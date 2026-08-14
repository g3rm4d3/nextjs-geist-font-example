import type { AdminPaymentDetail, AdminPaymentSummary } from '@rideshare/types';
import { NotFoundError } from '../lib/errors';
import {
  findPaymentAdminRowById,
  listAllPaymentsForAdmin,
  type PaymentAdminRow,
} from '../repositories/paymentsRepository';

type PaymentStatus = AdminPaymentSummary['status'];

function toSummary(row: PaymentAdminRow): AdminPaymentSummary {
  return {
    id: row.id,
    rideId: row.rideId,
    status: row.status,
    amountCents: row.amountCents,
    currency: row.currency,
    passengerName: `${row.passengerFirstName} ${row.passengerLastName}`,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Section 14's "Payments" — provider-safe only, same as every other
 * payment-facing surface in this codebase (no raw card data anywhere). */
export async function listPayments(statusFilter?: PaymentStatus): Promise<AdminPaymentSummary[]> {
  const rows = await listAllPaymentsForAdmin(undefined, statusFilter);
  return rows.map(toSummary);
}

/** "Inspect payment." */
export async function getPaymentDetail(paymentId: string): Promise<AdminPaymentDetail> {
  const row = await findPaymentAdminRowById(paymentId);
  if (!row) throw new NotFoundError('Payment not found');

  return {
    ...toSummary(row),
    providerPaymentIntentId: row.providerPaymentIntentId,
    failureReason: row.failureReason,
    refundedAt: row.refundedAt ? row.refundedAt.toISOString() : null,
    refundReason: row.refundReason,
  };
}
