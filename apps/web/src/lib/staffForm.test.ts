import { describe, expect, it } from 'vitest'
import { buildStaffInput, buildStaffUpdate } from './staffForm.ts'
import type { StaffMember } from './staff.ts'

const base = { role: 'DOCTOR' as const, fullName: ' د. سمير ', username: ' Dr.Samir ', phone: '', specialty: '', canManagePayments: false }
const member: StaffMember = { id: '1', username: 'a', fullName: 'سمير', phone: '0599123456', role: 'DOCTOR', isActive: true, canManagePayments: false, mustChangePassword: false, createdAt: '', doctor: { id: 'd', specialty: 'تقويم', isActive: true } }

describe('buildStaffInput', () => {
  it('trims, lowercases the username and leaves empty optional fields out', () => {
    expect(buildStaffInput(base)).toEqual({ input: { username: 'dr.samir', fullName: 'د. سمير', role: 'DOCTOR' } })
  })
  it('keeps specialty for doctors only, and the payments flag only when on', () => {
    expect(buildStaffInput({ ...base, specialty: 'تقويم', canManagePayments: true })).toEqual({ input: { username: 'dr.samir', fullName: 'د. سمير', role: 'DOCTOR', specialty: 'تقويم', canManagePayments: true } })
    expect(buildStaffInput({ ...base, role: 'SECRETARY', specialty: 'تقويم' })).toEqual({ input: { username: 'dr.samir', fullName: 'د. سمير', role: 'SECRETARY' } })
  })
  it('explains what is wrong', () => {
    for (const bad of [{ fullName: 'س' }, { username: 'ab' }, { username: 'has space' }, { username: 'عربي' }, { phone: '123' }, { specialty: 'ت' }]) {
      expect('error' in buildStaffInput({ ...base, ...bad })).toBe(true)
    }
  })
})

describe('buildStaffUpdate', () => {
  const same = { fullName: 'سمير', phone: '0599123456', specialty: 'تقويم', canManagePayments: false }
  it('sends only what changed', () => {
    expect(buildStaffUpdate(member, { ...same, fullName: 'سمير خليل' })).toEqual({ input: { fullName: 'سمير خليل' } })
    expect(buildStaffUpdate(member, { ...same, phone: '', specialty: '', canManagePayments: true })).toEqual({ input: { phone: null, specialty: null, canManagePayments: true } })
  })
  it('says so when nothing changed, and validates', () => {
    expect(buildStaffUpdate(member, same)).toEqual({ error: 'ما غيّرت أي شي' })
    expect('error' in buildStaffUpdate(member, { ...same, fullName: 'x' })).toBe(true)
    expect('error' in buildStaffUpdate(member, { ...same, phone: '12' })).toBe(true)
  })
  it('a secretary has no specialty to change', () => {
    expect(buildStaffUpdate({ ...member, doctor: null }, { ...same, specialty: 'ignored', fullName: 'رنا' })).toEqual({ input: { fullName: 'رنا' } })
  })
})
