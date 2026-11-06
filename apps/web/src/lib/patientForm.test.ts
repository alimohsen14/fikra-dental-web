import { describe, expect, it } from 'vitest'
import { buildPatientBody, EMPTY_PATIENT } from './patientForm.ts'

const good = { ...EMPTY_PATIENT, fullName: ' محمد خالد ', phone: '0599000001', gender: 'MALE' as const }

describe('buildPatientBody (new patient)', () => {
  it('trims, and leaves empty optional fields out', () => {
    expect(buildPatientBody(good)).toEqual({ body: { fullName: 'محمد خالد', phone: '0599000001', gender: 'MALE' } })
  })
  it('rejects missing name / phone, short id, bad birth dates', () => {
    for (const bad of [{ fullName: 'م' }, { phone: '  ' }, { nationalId: '123' }, { birthDate: '2999-01-01' }, { birthDate: '1800-01-01' }, { birthDate: '2020-02-31' }]) {
      expect(buildPatientBody({ ...good, ...bad })).toHaveProperty('error')
    }
  })
})

describe('buildPatientBody (edit)', () => {
  const original = { ...good, fullName: 'محمد خالد', notes: 'ملاحظة' }
  it('sends only what changed', () => {
    expect(buildPatientBody({ ...original, phone: '0599111222' }, original)).toEqual({ body: { phone: '0599111222' } })
  })
  it('a cleared field is sent as an empty string so the API clears it', () => {
    expect(buildPatientBody({ ...original, notes: '' }, original)).toEqual({ body: { notes: '' } })
  })
  it('nothing changed -> a message, not an empty request', () => {
    expect(buildPatientBody({ ...original, fullName: ' محمد خالد ' }, original)).toHaveProperty('error')
  })
  it("the patient's own page has no phone: it is not required and never sent", () => {
    const v = { ...EMPTY_PATIENT, fullName: 'كريم خالد', gender: 'MALE' as const, phone: '0599000000' }
    expect(buildPatientBody({ ...v, phone: '' }, undefined, { needPhone: false })).toEqual({ body: { fullName: 'كريم خالد', gender: 'MALE' } })
    expect(buildPatientBody(v, undefined, { needPhone: false })).toEqual({ body: { fullName: 'كريم خالد', gender: 'MALE' } })
    expect(buildPatientBody({ ...v, phone: '' })).toHaveProperty('error')
  })
})
