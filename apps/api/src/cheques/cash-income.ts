import type { Prisma } from '../generated/prisma/client.js';

/**
 * Clinic income from patients. A cash/card/transfer payment counts on the day it was paid. A cheque payment lowers the patient's balance
 * at once but only counts as income from the day the cheque is CASHED, or the day it is handed on to pay a bill (ENDORSED: it was used as
 * money, and the bill it paid is an expense of the same day). A pending or returned cheque is not money.
 */
export function cashIncomeWhere(range: { gte: Date; lt: Date }): Prisma.PaymentWhereInput {
  return {
    status: 'ACTIVE',
    OR: [
      { method: { not: 'CHEQUE' }, paidAt: range },
      { method: 'CHEQUE', cheque: { is: { status: 'CASHED', cashedAt: range } } },
      { method: 'CHEQUE', cheque: { is: { status: 'ENDORSED', endorsedAt: range } } },
    ],
  };
}

/** The day a payment counts as income (null: not yet). Use together with `cheque: { select: { cashedAt: true, endorsedAt: true, status: true } }`. */
export const cashAt = (p: { method: string; paidAt: Date; cheque?: { status?: string; cashedAt: Date | null; endorsedAt?: Date | null } | null }): Date | null =>
  p.method === 'CHEQUE' ? (p.cheque?.status === 'ENDORSED' ? (p.cheque.endorsedAt ?? null) : (p.cheque?.cashedAt ?? null)) : p.paidAt;

/** When a bill payment is voided (or the bill is), the cheques behind it let go: a handed-on cheque is back in hand, one we wrote is cancelled. */
export async function releaseChequesOf(tx: Prisma.TransactionClient, clinicId: string, expensePaymentIds: string[]): Promise<void> {
  if (expensePaymentIds.length === 0) return;
  await tx.cheque.updateMany({ where: { clinicId, expensePaymentId: { in: expensePaymentIds }, direction: 'INCOMING', status: 'ENDORSED' }, data: { status: 'PENDING', endorsedAt: null, expensePaymentId: null } });
  await tx.cheque.updateMany({ where: { clinicId, expensePaymentId: { in: expensePaymentIds }, direction: 'OUTGOING', status: { in: ['PENDING', 'CASHED'] } }, data: { status: 'CANCELLED' } });
}
