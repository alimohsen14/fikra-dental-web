import { describe, expect, it } from 'vitest'
import { canEditTreatments, canSeeMoney, canSeeTreatments } from './access.ts'

describe('who can do what with treatments', () => {
  it('the owner can do everything', () => {
    const u = { role: 'OWNER', canManagePayments: false } as const
    expect([canSeeMoney(u), canEditTreatments(u), canSeeTreatments(u)]).toEqual([true, true, true])
  })
  it('a doctor edits treatments but sees money only with the key', () => {
    expect([canSeeMoney({ role: 'DOCTOR' }), canEditTreatments({ role: 'DOCTOR' }), canSeeTreatments({ role: 'DOCTOR' })]).toEqual([false, true, true])
    expect(canSeeMoney({ role: 'DOCTOR', canManagePayments: true })).toBe(true)
  })
  it('a secretary gets the treatments screens only with the key, and never edits', () => {
    expect([canSeeMoney({ role: 'SECRETARY' }), canEditTreatments({ role: 'SECRETARY' }), canSeeTreatments({ role: 'SECRETARY' })]).toEqual([false, false, false])
    const k = { role: 'SECRETARY', canManagePayments: true } as const
    expect([canSeeMoney(k), canEditTreatments(k), canSeeTreatments(k)]).toEqual([true, false, true])
  })
  it('the platform admin gets nothing', () => {
    expect(canSeeTreatments({ role: 'PLATFORM_ADMIN' })).toBe(false)
  })
})
