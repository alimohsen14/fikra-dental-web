import { describe, expect, it } from 'vitest'
import { buildStatement } from './statement.ts'
import type { Treatment } from './treatments.ts'

const type = (name: string) => ({ id: name, name, parent: null })
function t(o: Partial<Treatment> & { id: string }): Treatment {
  return {
    patientId: 'p', doctorId: 'd', appointmentId: null, description: null, totalCost: 0, plannedSessions: 1, status: 'OPEN', startedAt: '2026-11-01T08:00:00Z', closedAt: null, createdAt: '2026-11-01T08:00:00Z',
    doctor: { id: 'd', fullName: 'د. سامي' }, patient: { id: 'p', fullName: 'ليلى' }, toothCodes: [16], access: { edit: true, pay: true },
    teeth: [{ toothCode: 16, treatmentTypeId: 'حشوة', treatmentType: type('حشوة') }], sessions: [], paid: 0, remaining: 0, payments: [], ...o,
  } as Treatment
}
const pay = (id: string, amount: number, paidAt: string, status: 'ACTIVE' | 'VOIDED' = 'ACTIVE') => ({ id, amount, method: 'CASH' as const, paidAt, note: null, status, voidedAt: null, voidReason: status === 'VOIDED' ? 'خطأ' : null, createdAt: paidAt })

describe('patient statement', () => {
  it('one line per treatment with totals; a treatment with many teeth is still one bill', () => {
    const s = buildStatement([
      t({ id: 'a', totalCost: 80000, paid: 80000, status: 'CLOSED', startedAt: '2026-10-01T08:00:00Z', toothCodes: [16, 17], payments: [pay('p1', 80000, '2026-10-02T08:00:00Z')] }),
      t({ id: 'b', totalCost: 300000, paid: 120000, startedAt: '2026-11-01T08:00:00Z', payments: [pay('p2', 120000, '2026-11-02T08:00:00Z')] }),
    ])!
    expect(s.rows.map((r) => [r.id, r.total, r.paid, r.remaining])).toEqual([['a', 80000, 80000, 0], ['b', 300000, 120000, 180000]])
    expect(s.rows[0]!.teeth).toBe('2 · 3') // FDI 16 and 17 shown as universal 2 and 3
    expect(s).toMatchObject({ total: 380000, paid: 200000, remaining: 180000 })
  })
  it('lists the oldest first, in treatments and in payments', () => {
    const s = buildStatement([
      t({ id: 'new', startedAt: '2026-11-05T08:00:00Z', payments: [pay('n1', 100, '2026-11-06T08:00:00Z')], paid: 100, totalCost: 100 }),
      t({ id: 'old', startedAt: '2026-09-05T08:00:00Z', payments: [pay('o1', 100, '2026-09-06T08:00:00Z'), pay('o2', 50, '2026-09-20T08:00:00Z')], paid: 150, totalCost: 150 }),
    ])!
    expect(s.rows.map((r) => r.id)).toEqual(['old', 'new'])
    expect(s.payments.map((p) => p.id)).toEqual(['o1', 'o2', 'n1'])
  })
  it('a voided payment is listed (with the reason) but never counted', () => {
    const s = buildStatement([t({ id: 'a', totalCost: 1000, paid: 400, payments: [pay('x', 400, '2026-11-02T08:00:00Z'), pay('y', 600, '2026-11-03T08:00:00Z', 'VOIDED')] })])!
    expect(s.payments.find((p) => p.id === 'y')).toMatchObject({ voided: true, voidReason: 'خطأ' })
    expect(s).toMatchObject({ paid: 400, remaining: 600 })
  })
  it('cancelled treatments are left out entirely', () => {
    const s = buildStatement([t({ id: 'a', totalCost: 500, paid: 0 }), t({ id: 'c', status: 'CANCELLED', totalCost: 9999, paid: 0 })])!
    expect(s.rows.map((r) => r.id)).toEqual(['a'])
    expect(s.total).toBe(500)
  })
  it('a user who may not see money gets no statement; a patient with no treatments gets an empty one', () => {
    expect(buildStatement([t({ id: 'a', paid: undefined, payments: undefined })])).toBeNull()
    expect(buildStatement([])).toMatchObject({ rows: [], payments: [], total: 0, paid: 0, remaining: 0 })
  })
  it('an over-paid treatment never shows a negative remainder', () => {
    expect(buildStatement([t({ id: 'a', totalCost: 100, paid: 150 })])!.remaining).toBe(0)
  })
})
