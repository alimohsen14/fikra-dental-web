import { describe, expect, it } from 'vitest'
import { adjustmentForm, buildAdjustment, buildMonthlySalary, buildSalaryPayment, monthName, shiftMonth } from './salaries.ts'

describe('shiftMonth / monthName', () => {
  it('moves across year ends', () => {
    expect(shiftMonth('2026-11', -1)).toBe('2026-10')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-11', -12)).toBe('2025-11')
  })
  it('names the month in Arabic', () => {
    expect(monthName('2026-11')).toBe('تشرين الثاني 2026')
    expect(monthName('2026-01')).toBe('كانون الثاني 2026')
  })
})

describe('buildSalaryPayment', () => {
  const f = { kind: 'ADVANCE' as const, amount: '500', method: 'CASH' as const, day: '2020-01-15', note: ' سلفة ' }
  it('builds an advance', () => {
    const r = buildSalaryPayment(f, 300000)
    expect('body' in r && r.body).toMatchObject({ kind: 'ADVANCE', amount: 50000, note: 'سلفة' })
  })
  it('never above what is left of the month', () => {
    expect(buildSalaryPayment(f, 40000)).toHaveProperty('error')
    expect(buildSalaryPayment({ ...f, amount: 'x' }, 300000)).toHaveProperty('error')
    expect(buildSalaryPayment({ ...f, day: '' }, 300000)).toHaveProperty('error')
  })
})

describe('buildAdjustment', () => {
  it('bonus is positive, deduction negative', () => {
    expect(buildAdjustment({ type: 'bonus', amount: '200', note: '' }, 300000, 0)).toEqual({ body: { adjustment: 20000 } })
    const d = buildAdjustment({ type: 'deduction', amount: '50', note: 'تأخير' }, 300000, 0)
    expect('body' in d && d.body).toEqual({ adjustment: -5000, adjustNote: 'تأخير' })
  })
  it('empty amount clears the adjustment', () => {
    expect(buildAdjustment({ type: 'bonus', amount: '', note: '' }, 300000, 0)).toEqual({ body: { adjustment: 0 } })
  })
  it('refuses a deduction bigger than the salary or than what was given', () => {
    expect(buildAdjustment({ type: 'deduction', amount: '4000', note: '' }, 300000, 0)).toHaveProperty('error')
    expect(buildAdjustment({ type: 'deduction', amount: '1500', note: '' }, 300000, 200000)).toHaveProperty('error')
    expect(buildAdjustment({ type: 'bonus', amount: 'abc', note: '' }, 300000, 0)).toHaveProperty('error')
  })
  it('round-trips through the form', () => {
    expect(adjustmentForm(-5000, 'x')).toEqual({ type: 'deduction', amount: '50', note: 'x' })
    expect(adjustmentForm(0, null)).toEqual({ type: 'bonus', amount: '', note: '' })
  })
})

describe('buildMonthlySalary', () => {
  it('parses shekels', () => {
    expect(buildMonthlySalary('3000')).toEqual({ amount: 300000 })
    expect(buildMonthlySalary('abc')).toHaveProperty('error')
  })
})
