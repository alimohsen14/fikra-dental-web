import { addDaysTo, weekdayOfDate } from '../scheduling/clinic-time.js';

export type Period = 'day' | 'week' | 'month' | 'year';

/** Calendar days: `from` included, `to` excluded. The week starts on Saturday, as in Palestine. */
export function periodRange(period: Period, date: string): { from: string; to: string } {
  const [y, m] = date.split('-').map(Number) as [number, number];
  switch (period) {
    case 'day':
      return { from: date, to: addDaysTo(date, 1) };
    case 'week': {
      const back = (weekdayOfDate(date) + 1) % 7; // Sat 0, Sun 1, ... Fri 6
      const from = addDaysTo(date, -back);
      return { from, to: addDaysTo(from, 7) };
    }
    case 'month': {
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
      return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: next };
    }
    case 'year':
      return { from: `${y}-01-01`, to: `${y + 1}-01-01` };
  }
}

export interface PaymentLike {
  amount: number;
  status: 'ACTIVE' | 'VOIDED';
}
export const paidTotal = (payments: PaymentLike[]): number => payments.reduce((t, p) => (p.status === 'ACTIVE' ? t + p.amount : t), 0);
export const remainingOf = (amount: number, payments: PaymentLike[]): number => Math.max(0, amount - paidTotal(payments));

/** "2026-11" moved by whole months (negative = back). */
export function shiftMonth(month: string, steps: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + steps;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
