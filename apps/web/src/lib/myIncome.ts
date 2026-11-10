import { request } from './api.ts'
import type { Period } from './expenses.ts'
import { isDate } from './schedule.ts'
import type { PaymentMethod } from './treatments.ts'

export interface MyPayment {
  id: string
  amount: number
  method: PaymentMethod
  paidAt: string
  treatmentId: string
  patient: { id: string; fullName: string }
}
export interface MyIncome {
  period: Period
  from: string
  to: string
  income: number
  count: number
  payments: MyPayment[]
}
export interface MyMonth {
  month: string
  income: number
}

export const getMyIncome = (period: Period, date: string) => request<MyIncome>(`/my-income?period=${period}&date=${date}`)
export const getMyMonths = (year: number) => request<MyMonth[]>(`/my-income/months?year=${year}`)

/** What the doctor earned over the months of a year, and the best month (only if there was any income). */
export function yearSummary(months: MyMonth[]): { total: number; best: MyMonth | null } {
  const total = months.reduce((t, m) => t + m.income, 0)
  const best = months.reduce<MyMonth | null>((b, m) => (m.income > 0 && (b === null || m.income > b.income) ? m : b), null)
  return { total, best }
}

/** A day picked from the calendar: only a real date, not in the future. Anything else is ignored (null), e.g. a cleared field. */
export function pickedDay(value: string, today: string): string | null {
  return isDate(value) && value <= today ? value : null
}
