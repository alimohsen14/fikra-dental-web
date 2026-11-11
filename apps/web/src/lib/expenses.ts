import { request } from './api.ts'
import { formatMoney, FUTURE_DAY_ERROR, isFutureDay, paidAtIso, parseShekels } from './format.ts'
import type { PaymentMethod } from './treatments.ts'

export type Period = 'day' | 'week' | 'month' | 'year'
export const PERIOD_LABELS: Record<Period, string> = { day: 'يوم', week: 'أسبوع', month: 'شهر', year: 'سنة' }

export interface Category {
  id: string
  name: string
  isActive: boolean
}
export interface Supplier {
  id: string
  name: string
  phone: string | null
  notes: string | null
  isActive: boolean
  owed: number
}
export interface SuppliersResult {
  suppliers: Supplier[]
  owedTotal: number
  owedUnassigned: number
}
export interface ExpensePaymentRow {
  id: string
  amount: number
  method: PaymentMethod
  paidAt: string
  note: string | null
  status: 'ACTIVE' | 'VOIDED'
  voidedAt: string | null
  voidReason: string | null
}
export interface Expense {
  id: string
  categoryId: string
  supplierId: string | null
  description: string | null
  amount: number
  incurredAt: string
  status: 'ACTIVE' | 'VOIDED'
  voidReason: string | null
  category: { id: string; name: string }
  supplier: { id: string; name: string } | null
  payments: ExpensePaymentRow[]
  paid: number
  remaining: number
}
export interface Summary {
  period: Period
  from: string
  to: string
  income: number
  incomeCount: number
  expensesPaid: number
  expensesIncurred: number
  profit: number
  byCategory: { categoryId: string; name: string; incurred: number; paid: number }[]
  owedNow: number
}

export interface MonthRow {
  month: string
  income: number
  expensesPaid: number
  salariesPaid: number
  profit: number
}
/** January to December of one year, oldest first (months that have not come yet are all zero). */
export const listYearMonths = (year: number) => request<MonthRow[]>(`/expenses/months?year=${year}`)

/** Newest first, so the current month is on top; months with nothing at all before the first activity are dropped. */
export function monthsForTable(rows: MonthRow[]): MonthRow[] {
  const first = rows.findIndex((r) => r.income !== 0 || r.expensesPaid !== 0 || r.salariesPaid !== 0)
  return first === -1 ? rows.slice(-1) : rows.slice(first).reverse()
}

/** How much the profit moved compared with the month before it; null for the first month shown. */
export function profitChange(oldestFirst: MonthRow[], month: string): number | null {
  const i = oldestFirst.findIndex((r) => r.month === month)
  const here = oldestFirst[i]
  const before = oldestFirst[i - 1]
  return i <= 0 || !here || !before ? null : here.profit - before.profit
}

export const listCategories = () => request<Category[]>('/expense-categories')
export const createCategory = (name: string) => request<Category>('/expense-categories', { method: 'POST', body: { name } })
export const addDefaultCategories = () => request<Category[]>('/expense-categories/defaults', { method: 'POST', body: {} })
export const listSuppliers = () => request<SuppliersResult>('/suppliers')
export const createSupplier = (body: { name: string; phone?: string }) => request<Supplier>('/suppliers', { method: 'POST', body })
export const listExpenses = (q: { from?: string; to?: string; supplierId?: string; unpaid?: boolean }) => {
  const p = new URLSearchParams()
  if (q.from) p.set('from', q.from)
  if (q.to) p.set('to', q.to)
  if (q.supplierId) p.set('supplierId', q.supplierId)
  if (q.unpaid) p.set('unpaid', '1')
  return request<Expense[]>(`/expenses?${p.toString()}`)
}
export const getSummary = (period: Period, date: string) => request<Summary>(`/expenses/summary?period=${period}&date=${date}`)
export const createExpense = (body: unknown) => request<Expense>('/expenses', { method: 'POST', body })
export const payExpense = (id: string, body: unknown) => request<Expense>(`/expenses/${id}/payments`, { method: 'POST', body })
export const voidExpense = (id: string, reason: string) => request<Expense>(`/expenses/${id}/void`, { method: 'POST', body: { reason } })
export const voidExpensePayment = (id: string, reason: string) => request<Expense>(`/expense-payments/${id}/void`, { method: 'POST', body: { reason } })

// ---------------------------------------------------------------- pure helpers
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
const parse = (s: string) => new Date(`${s}T00:00:00Z`)

/** Move a day forward/back by one period ("2026-11-07", 'month', -1 -> "2026-10-07"; short months clamp to their last day). */
export function shiftDate(date: string, period: Period, steps: number): string {
  const d = parse(date)
  if (period === 'day') d.setUTCDate(d.getUTCDate() + steps)
  else if (period === 'week') d.setUTCDate(d.getUTCDate() + 7 * steps)
  else {
    const day = d.getUTCDate()
    d.setUTCDate(1)
    d.setUTCMonth(d.getUTCMonth() + (period === 'month' ? steps : 12 * steps))
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
    d.setUTCDate(Math.min(day, last))
  }
  return iso(d)
}

const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول']

/** The heading of the period the summary covers. */
export function periodTitle(s: { period: Period; from: string; to: string }): string {
  if (s.period === 'day') return s.from
  if (s.period === 'week') return `من ${s.from} إلى ${s.to}`
  const d = parse(s.from)
  return s.period === 'month' ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : String(d.getUTCFullYear())
}

/** True when moving forward would go past today (we do not browse the future). */
export const isCurrent = (s: { to: string }, today: string): boolean => s.to >= today

type ExpenseForm = { categoryId: string; supplierId: string; description: string; amount: string; day: string; paid: 'full' | 'none' | 'part'; paidAmount: string; method: PaymentMethod }

export function buildExpenseBody(f: ExpenseForm): { error: string } | { body: Record<string, unknown> } {
  if (!f.categoryId) return { error: 'اختر نوع المصروف' }
  const amount = parseShekels(f.amount)
  if (amount === null || amount < 1) return { error: 'اكتب المبلغ كرقم، مثال: 250' }
  if (!f.day) return { error: 'اختر التاريخ' }
  let paidAmount: number | undefined
  if (f.paid === 'none') paidAmount = 0
  if (f.paid === 'part') {
    const p = parseShekels(f.paidAmount)
    if (p === null || p < 1) return { error: 'اكتب المبلغ المدفوع كرقم' }
    if (p >= amount) return { error: 'يجب أن يكون المدفوع أقل من المبلغ الكامل (أو اختر «مدفوع كامل»)' }
    paidAmount = p
  }
  if (f.paid !== 'none' && !f.method) return { error: 'اختر طريقة الدفع' }
  if (isFutureDay(f.day)) return { error: FUTURE_DAY_ERROR }
  return {
    body: {
      categoryId: f.categoryId,
      ...(f.supplierId ? { supplierId: f.supplierId } : {}),
      ...(f.description.trim() ? { description: f.description.trim() } : {}),
      amount,
      incurredAt: paidAtIso(f.day),
      ...(paidAmount !== undefined ? { paidAmount } : {}),
      ...(f.paid !== 'none' ? { method: f.method } : {}),
    },
  }
}

export function buildExpensePayment(
  f: { amount: string; method: PaymentMethod; day: string; note: string },
  remaining: number,
): { error: string } | { body: { amount: number; method: PaymentMethod; paidAt: string; note?: string } } {
  const amount = parseShekels(f.amount)
  if (amount === null || amount < 1) return { error: 'اكتب مبلغ الدفعة كرقم، مثال: 300' }
  if (amount > remaining) return { error: `المبلغ أكبر من المتبقي (${formatMoney(remaining)})` }
  if (!f.day) return { error: 'اختر تاريخ الدفعة' }
  if (isFutureDay(f.day)) return { error: FUTURE_DAY_ERROR }
  return { body: { amount, method: f.method, paidAt: paidAtIso(f.day), ...(f.note.trim() ? { note: f.note.trim() } : {}) } }
}
