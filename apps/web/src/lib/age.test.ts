import { describe, expect, it } from 'vitest'
import { ageInYears, ageLabel } from './format.ts'

describe('age', () => {
  it('counts whole years, and a birthday that has not come yet this year does not count', () => {
    expect(ageInYears('2000-11-11', '2026-11-11')).toBe(26)
    expect(ageInYears('2000-11-12', '2026-11-11')).toBe(25)
    expect(ageInYears('2000-12-01T00:00:00.000Z', '2026-11-11')).toBe(25)
  })
  it('no birth date, junk or a date in the future gives nothing', () => {
    expect(ageInYears(null, '2026-11-11')).toBeNull()
    expect(ageInYears('', '2026-11-11')).toBeNull()
    expect(ageInYears('abc', '2026-11-11')).toBeNull()
    expect(ageInYears('2030-01-01', '2026-11-11')).toBeNull()
  })
  it('labels in Arabic', () => {
    expect(ageLabel(null, '2026-11-11')).toBe('-')
    expect(ageLabel('2026-05-01', '2026-11-11')).toBe('أقل من سنة')
    expect(ageLabel('2025-11-11', '2026-11-11')).toBe('سنة')
    expect(ageLabel('2024-11-11', '2026-11-11')).toBe('سنتان')
    expect(ageLabel('2020-11-11', '2026-11-11')).toBe('6 سنوات')
    expect(ageLabel('2000-11-11', '2026-11-11')).toBe('26 سنة')
  })
})
