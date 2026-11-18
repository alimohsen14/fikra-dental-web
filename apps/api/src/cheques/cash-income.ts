import type { Prisma } from '../generated/prisma/client.js';

/**
 * Clinic cash income. A cash/card/transfer payment counts on the day it was paid. A cheque payment lowers the patient's balance at once
 * but only counts as income from the day the cheque is CASHED (a pending or returned cheque is not money in the bank).
 */
export function cashIncomeWhere(range: { gte: Date; lt: Date }): Prisma.PaymentWhereInput {
  return {
    status: 'ACTIVE',
    OR: [{ method: { not: 'CHEQUE' }, paidAt: range }, { method: 'CHEQUE', cheque: { is: { status: 'CASHED', cashedAt: range } } }],
  };
}

/** The day a payment counts as income (null: not yet). Use together with `cheque: { select: { cashedAt: true } }`. */
export const cashAt = (p: { method: string; paidAt: Date; cheque?: { cashedAt: Date | null } | null }): Date | null => (p.method === 'CHEQUE' ? (p.cheque?.cashedAt ?? null) : p.paidAt);
