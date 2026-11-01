// Money is whole agorot (integers). Balances are always computed from payments, never stored.

export interface PaymentLike {
  amount: number;
  status: 'ACTIVE' | 'VOIDED';
}

export function paidTotal(payments: PaymentLike[]): number {
  return payments.reduce((t, p) => (p.status === 'ACTIVE' ? t + p.amount : t), 0);
}

export function moneyOf(totalCost: number, payments: PaymentLike[]) {
  const paid = paidTotal(payments);
  return { paid, remaining: Math.max(0, totalCost - paid) };
}

/** A treatment closes only when it is fully paid AND every session is done. */
export function shouldClose(totalCost: number, payments: PaymentLike[], sessions: { status: 'PLANNED' | 'COMPLETED' }[]): boolean {
  return paidTotal(payments) >= totalCost && sessions.length > 0 && sessions.every((s) => s.status === 'COMPLETED');
}
