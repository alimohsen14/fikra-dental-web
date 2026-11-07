import { describe, expect, it } from 'vitest'
import { buildExpenseBody, buildExpensePayment, isCurrent, monthsForTable, periodTitle, profitChange, shiftDate } from './expenses.ts'
import type { MonthRow } from './expenses.ts'

const form = { categoryId: 'c', supplierId: '', description: '', amount: '250', day: '2020-01-15', paid: 'full' as const, paidAmount: '', method: 'CASH' as const }

describe('shiftDate', () => {
  it('moves by day, week, month and year', () => {
    expect(shiftDate('2026-11-07', 'day', -1)).toBe('2026-11-06')
    expect(shiftDate('2026-11-07', 'week', 1)).toBe('2026-11-14')
    expect(shiftDate('2026-11-07', 'month', -1)).toBe('2026-10-07')
    expect(shiftDate('2026-01-15', 'month', -1)).toBe('2025-12-15')
    expect(shiftDate('2026-11-07', 'year', -1)).toBe('2025-11-07')
  })
  it('clamps to the end of a shorter month', () => {
    expect(shiftDate('2026-03-31', 'month', -1)).toBe('2026-02-28')
    expect(shiftDate('2024-02-29', 'year', 1)).toBe('2025-02-28')
  })
})

describe('periodTitle / isCurrent', () => {
  it('titles each period', () => {
    expect(periodTitle({ period: 'day', from: '2026-11-07', to: '2026-11-07' })).toBe('2026-11-07')
    expect(periodTitle({ period: 'week', from: '2026-11-07', to: '2026-11-13' })).toBe('من 2026-11-07 إلى 2026-11-13')
    expect(periodTitle({ period: 'month', from: '2026-11-01', to: '2026-11-30' })).toBe('تشرين الثاني 2026')
    expect(periodTitle({ period: 'year', from: '2026-01-01', to: '2026-12-31' })).toBe('2026')
  })
  it('knows when the period contains today', () => {
    expect(isCurrent({ to: '2026-11-30' }, '2026-11-07')).toBe(true)
    expect(isCurrent({ to: '2026-10-31' }, '2026-11-07')).toBe(false)
  })
})

describe('buildExpenseBody', () => {
  it('paid in full omits paidAmount', () => {
    const r = buildExpenseBody(form)
    expect('body' in r && r.body).toMatchObject({ categoryId: 'c', amount: 25000, method: 'CASH' })
    expect('body' in r && 'paidAmount' in r.body).toBe(false)
  })
  it('on credit sends 0 and no method', () => {
    const r = buildExpenseBody({ ...form, paid: 'none', supplierId: 's' })
    expect('body' in r && r.body).toMatchObject({ paidAmount: 0, supplierId: 's' })
    expect('body' in r && 'method' in r.body).toBe(false)
  })
  it('partly paid needs a smaller paid amount', () => {
    const r = buildExpenseBody({ ...form, paid: 'part', paidAmount: '100' })
    expect('body' in r && r.body).toMatchObject({ paidAmount: 10000 })
    expect(buildExpenseBody({ ...form, paid: 'part', paidAmount: '250' })).toHaveProperty('error')
    expect(buildExpenseBody({ ...form, paid: 'part', paidAmount: '' })).toHaveProperty('error')
  })
  it('refuses missing category, bad amount, missing day', () => {
    expect(buildExpenseBody({ ...form, categoryId: '' })).toHaveProperty('error')
    expect(buildExpenseBody({ ...form, amount: 'abc' })).toHaveProperty('error')
    expect(buildExpenseBody({ ...form, amount: '0' })).toHaveProperty('error')
    expect(buildExpenseBody({ ...form, day: '' })).toHaveProperty('error')
  })
})

describe('buildExpensePayment', () => {
  const f = { amount: '50', method: 'CARD' as const, day: '2020-01-15', note: ' x ' }
  it('builds a payment', () => {
    const r = buildExpensePayment(f, 10000)
    expect('body' in r && r.body).toMatchObject({ amount: 5000, method: 'CARD', note: 'x' })
  })
  it('never above the remaining', () => {
    expect(buildExpensePayment({ ...f, amount: '101' }, 10000)).toHaveProperty('error')
    expect(buildExpensePayment({ ...f, amount: '' }, 10000)).toHaveProperty('error')
  })
})

const row = (month: string, income: number, expensesPaid = 0, salariesPaid = 0): MonthRow => ({ month, income, expensesPaid, salariesPaid, profit: income - expensesPaid - salariesPaid })

describe('monthsForTable', () => {
  it('newest first, skipping the empty months before the first activity', () => {
    const rows = [row('2026-08', 0), row('2026-09', 100), row('2026-10', 0), row('2026-11', 300, 50)]
    expect(monthsForTable(rows).map((r) => r.month)).toEqual(['2026-11', '2026-10', '2026-09'])
  })
  it('keeps the current month when nothing ever happened', () => {
    expect(monthsForTable([row('2026-10', 0), row('2026-11', 0)]).map((r) => r.month)).toEqual(['2026-11'])
  })
})

describe('profitChange', () => {
  const rows = [row('2026-09', 100), row('2026-10', 300, 50), row('2026-11', 0, 40)]
  it('compares with the month before', () => {
    expect(profitChange(rows, '2026-10')).toBe(150)
    expect(profitChange(rows, '2026-11')).toBe(-290)
  })
  it('nothing to compare with for the first month or an unknown one', () => {
    expect(profitChange(rows, '2026-09')).toBeNull()
    expect(profitChange(rows, '1999-01')).toBeNull()
  })
})
