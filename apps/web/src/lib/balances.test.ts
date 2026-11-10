import { describe, expect, it } from 'vitest'
import { filterBalances } from './balances.ts'
import type { PatientBalance } from './balances.ts'

const row = (fullName: string, phone: string, remaining: number): PatientBalance => ({ patientId: fullName, fullName, phone, total: remaining, paid: 0, remaining, openTreatments: 1, lastPaidAt: null })
const items = [row('أحمد علي', '+970599111222', 90_000), row('سارة خالد', '+970597333444', 50_000), row('Ahmad Omar', '+970592555666', 10_000)]

describe('filterBalances', () => {
  it('keeps everything (in order) for an empty search', () => {
    expect(filterBalances(items, '  ')).toEqual(items)
  })
  it('finds by name, case-insensitively', () => {
    expect(filterBalances(items, 'ahmad').map((i) => i.fullName)).toEqual(['Ahmad Omar'])
    expect(filterBalances(items, 'سارة').map((i) => i.fullName)).toEqual(['سارة خالد'])
  })
  it('finds by any part of the phone number, ignoring spaces and the plus', () => {
    expect(filterBalances(items, '0597 333').map((i) => i.fullName)).toEqual(['سارة خالد'])
    expect(filterBalances(items, '+970599').map((i) => i.fullName)).toEqual(['أحمد علي'])
  })
  it('a name search with no digits never matches phones', () => {
    expect(filterBalances(items, 'zzz')).toEqual([])
  })
})
