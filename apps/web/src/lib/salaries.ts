import { request } from './api.ts'
import { formatMoney, FUTURE_DAY_ERROR, isFutureDay, paidAtIso, parseShekels } from './format.ts'
import type { PaymentMethod } from './treatments.ts'

export type PayKind = 'SALARY' | 'ADVANCE'

export interface SalaryPaymentRow {
  id: string
  kind: PayKind
  amount: number
  method: PaymentMethod
  paidAt: string
  note: string | null
  status: 'ACTIVE' | 'VOIDED'
  voidedAt: string | null
  voidReason: string | null
}
export interface SalaryEntry {
  id: string
  userId: string
  month: string
  baseAmount: number
  adjustment: number
  adjustNote: string | null
  user: { id: string; fullName: string; role: 'DOCTOR' | 'SECRETARY'; isActive: boolean }
  payments: SalaryPaymentRow[]
  net: number
  advances: number
  salaryPaid: number
  paid: number
  remaining: number
}
export interface StaffSalary {
  id: string
  fullName: string
  role: 'DOCTOR' | 'SECRETARY'
  monthlySalary: number | null
}
export interface SalaryMonth {
  month: string
  entries: SalaryEntry[]
  totals: { net: number; paid: number; advances: number; remaining: number }
  staff: StaffSalary[]
}

export const getSalaryMonth = (month: string) => request<SalaryMonth>(`/salaries?month=${month}`)
export const setMonthlySalary = (userId: string, monthlySalary: number) => request<{ id: string; monthlySalary: number }>(`/salaries/staff/${userId}`, { method: 'PATCH', body: { monthlySalary } })
export const adjustEntry = (id: string, body: { adjustment: number; adjustNote?: string }) => request<SalaryEntry>(`/salaries/${id}`, { method: 'PATCH', body })
export const paySalary = (id: string, body: unknown) => request<SalaryEntry>(`/salaries/${id}/payments`, { method: 'POST', body })
export const voidSalaryPayment = (id: string, reason: string) => request<SalaryEntry>(`/salary-payments/${id}/void`, { method: 'POST', body: { reason } })

// ---------------------------------------------------------------- pure helpers
export const monthOf = (day: string): string => day.slice(0, 7)

/** "2026-11" moved by whole months. */
export function shiftMonth(month: string, steps: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const t = y * 12 + (m - 1) + steps
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول']
export const monthName = (month: string): string => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`

export function buildSalaryPayment(
  f: { kind: PayKind; amount: string; method: PaymentMethod; day: string; note: string },
  remaining: number,
): { error: string } | { body: { kind: PayKind; amount: number; method: PaymentMethod; paidAt: string; note?: string } } {
  const amount = parseShekels(f.amount)
  if (amount === null || amount < 1) return { error: 'اكتب المبلغ كرقم، مثال: 500' }
  if (amount > remaining) return { error: `المبلغ أكبر من المتبقي من راتب الشهر (${formatMoney(remaining)})` }
  if (!f.day) return { error: 'اختر التاريخ' }
  if (isFutureDay(f.day)) return { error: FUTURE_DAY_ERROR }
  return { body: { kind: f.kind, amount, method: f.method, paidAt: paidAtIso(f.day), ...(f.note.trim() ? { note: f.note.trim() } : {}) } }
}

/** A bonus adds to this month's salary, a deduction subtracts; the result may not be below what was already given. */
export function buildAdjustment(
  f: { type: 'bonus' | 'deduction'; amount: string; note: string },
  base: number,
  alreadyGiven: number,
): { error: string } | { body: { adjustment: number; adjustNote?: string } } {
  const raw = f.amount.trim() === '' ? 0 : parseShekels(f.amount)
  if (raw === null) return { error: 'اكتب المبلغ كرقم، مثال: 200' }
  const adjustment = f.type === 'bonus' ? raw : -raw
  if (base + adjustment < 0) return { error: 'الخصم أكبر من الراتب' }
  if (base + adjustment < alreadyGiven) return { error: `الراتب بعد التعديل أقل من المبلغ المصروف (${formatMoney(alreadyGiven)})` }
  return { body: { adjustment, ...(f.note.trim() ? { adjustNote: f.note.trim() } : {}) } }
}

/** Splits a saved adjustment back into the form fields. */
export const adjustmentForm = (adjustment: number, note: string | null) => ({
  type: (adjustment < 0 ? 'deduction' : 'bonus') as 'bonus' | 'deduction',
  amount: adjustment === 0 ? '' : String(Math.abs(adjustment) / 100),
  note: note ?? '',
})

export function buildMonthlySalary(input: string): { error: string } | { amount: number } {
  const a = parseShekels(input)
  return a === null ? { error: 'اكتب الراتب كرقم، مثال: 3000' } : { amount: a }
}

/** Salaries are paid from the 25th of their own month. Earlier than that only advances make sense. */
export const SALARY_DUE_DAY = 25
export const salaryDueDate = (month: string): string => `${month}-${String(SALARY_DUE_DAY).padStart(2, '0')}`
/** Due once the 25th of that month has come (and always for earlier months). `today` is "YYYY-MM-DD". */
export const isSalaryDue = (month: string, today: string): boolean => today >= salaryDueDate(month)
export const monthNumber = (month: string): number => Number(month.slice(5, 7))

/** Net salary after the advances were taken out. */
export const afterAdvances = (e: { net: number; advances: number }): number => e.net - e.advances
