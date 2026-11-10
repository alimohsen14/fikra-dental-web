import { describe, expect, it } from 'vitest'
import { buildExpenseBody, buildExpensePayment } from './expenses.ts'
import { FUTURE_DAY_ERROR, isFutureDay, todayInput } from './format.ts'
import { buildPaymentInput } from './forms.ts'
import { buildSalaryPayment } from './salaries.ts'
import { buildTreatmentPayment } from './treatmentForm.ts'

const tomorrow = () => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA')
}
const yesterday = () => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toLocaleDateString('en-CA')
}

describe('money and treatment dates never go forward', () => {
  it('isFutureDay: tomorrow yes, today and the past no', () => {
    expect(isFutureDay(tomorrow())).toBe(true)
    expect(isFutureDay(todayInput())).toBe(false)
    expect(isFutureDay(yesterday())).toBe(false)
  })
  const pay = { amount: '100', method: 'CASH' as const, note: '' }
  it('every payment form refuses tomorrow (instead of quietly using today) and accepts today and yesterday', () => {
    for (const build of [
      (day: string) => buildTreatmentPayment({ ...pay, day }, 100_000),
      (day: string) => buildExpensePayment({ ...pay, day }, 100_000),
      (day: string) => buildSalaryPayment({ ...pay, kind: 'SALARY', day }, 100_000),
      (day: string) => buildPaymentInput({ amount: '100', day, periodId: 'p', note: '' }, 100_000),
    ]) {
      expect(build(tomorrow())).toEqual({ error: FUTURE_DAY_ERROR })
      expect(build(todayInput())).not.toHaveProperty('error')
      expect(build(yesterday())).not.toHaveProperty('error')
    }
  })
  it('a new expense refuses tomorrow too', () => {
    const f = { categoryId: 'c', supplierId: '', description: '', amount: '100', day: tomorrow(), paid: 'full' as const, paidAmount: '', method: 'CASH' as const }
    expect(buildExpenseBody(f)).toEqual({ error: FUTURE_DAY_ERROR })
    expect(buildExpenseBody({ ...f, day: todayInput() })).not.toHaveProperty('error')
  })
})
