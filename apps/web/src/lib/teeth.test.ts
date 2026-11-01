import { describe, expect, it } from 'vitest'
import { ADULT_LOWER, ADULT_UPPER, ageInYears, defaultSet, isBabyTooth, KIDS_LOWER, KIDS_UPPER, setOfTeeth, teethText, toggleTooth, toothKind, toothLabel, toothName, toothOrder } from './teeth.ts'

const NOW = new Date(2026, 10, 1) // 1 Nov 2026

describe('tooth rows', () => {
  it('have every tooth once, in the order the dentist looks at them', () => {
    expect(ADULT_UPPER).toHaveLength(16)
    expect(ADULT_UPPER.slice(0, 3)).toEqual([18, 17, 16])
    expect(ADULT_UPPER.slice(7, 9)).toEqual([11, 21])
    expect(ADULT_LOWER.slice(7, 9)).toEqual([41, 31])
    expect(new Set([...ADULT_UPPER, ...ADULT_LOWER]).size).toBe(32)
    expect(KIDS_UPPER).toEqual([55, 54, 53, 52, 51, 61, 62, 63, 64, 65])
    expect(KIDS_LOWER).toEqual([85, 84, 83, 82, 81, 71, 72, 73, 74, 75])
  })
})

describe('age and the default tooth set', () => {
  it('counts full years only', () => {
    expect(ageInYears('2020-11-01', NOW)).toBe(6)
    expect(ageInYears('2020-11-02', NOW)).toBe(5)
    expect(ageInYears('1994-06-21T00:00:00.000Z', NOW)).toBe(32)
    expect(ageInYears(null, NOW)).toBeNull()
    expect(ageInYears('2030-01-01', NOW)).toBeNull()
    expect(ageInYears('nonsense', NOW)).toBeNull()
  })
  it('under 6 baby teeth, 6 to 12 both, older (or unknown) permanent', () => {
    expect(defaultSet('2023-01-01', NOW)).toBe('kids')
    expect(defaultSet('2020-11-02', NOW)).toBe('kids')
    expect(defaultSet('2020-11-01', NOW)).toBe('both')
    expect(defaultSet('2014-11-01', NOW)).toBe('both') // 12
    expect(defaultSet('2013-10-31', NOW)).toBe('adult') // 13
    expect(defaultSet(null, NOW)).toBe('adult')
  })
  it('an existing treatment opens the set that holds its teeth', () => {
    expect(setOfTeeth([16, 26])).toBe('adult')
    expect(setOfTeeth([54])).toBe('kids')
    expect(setOfTeeth([16, 54])).toBe('both')
  })
})

describe('picking teeth', () => {
  it('toggles and keeps the list sorted', () => {
    expect(toggleTooth([], 26)).toEqual([26])
    expect(toggleTooth([26], 16)).toEqual([16, 26])
    expect(toggleTooth([48, 16], 11)).toEqual([16, 11, 48]) // chart order: 3, 8, 32
    expect(toggleTooth([16, 26], 26)).toEqual([16])
  })
  it('names a tooth', () => {
    expect(toothKind(16)).toBe('molar')
    expect(toothKind(24)).toBe('premolar')
    expect(toothKind(53)).toBe('canine')
    expect(toothKind(54)).toBe('molar')
    expect(toothName(16)).toBe('3 · ضرس علوي أيمن')
    expect(toothName(85)).toBe('T · ضرس سفلي أيمن (لبني)')
    expect(isBabyTooth(55)).toBe(true)
    expect(isBabyTooth(48)).toBe(false)
  })
})

describe('universal numbering (what the clinic sees)', () => {
  it('numbers the permanent teeth 1 to 32 from the upper right', () => {
    expect(ADULT_UPPER.map(toothLabel)).toEqual(Array.from({ length: 16 }, (_, i) => String(i + 1)))
    expect(ADULT_LOWER.map(toothLabel)).toEqual(Array.from({ length: 16 }, (_, i) => String(32 - i)))
    expect(['18', '11', '21', '28', '38', '31', '41', '48'].map((c) => toothLabel(Number(c)))).toEqual(['1', '8', '9', '16', '17', '24', '25', '32'])
    expect(toothLabel(16)).toBe('3')
    expect(toothLabel(46)).toBe('30')
  })
  it('letters the baby teeth A to T the same way', () => {
    expect(KIDS_UPPER.map(toothLabel).join('')).toBe('ABCDEFGHIJ')
    expect(KIDS_LOWER.map(toothLabel).join('')).toBe('TSRQPONMLK')
    expect(toothLabel(55)).toBe('A')
    expect(toothLabel(65)).toBe('J')
    expect(toothLabel(75)).toBe('K')
    expect(toothLabel(85)).toBe('T')
  })
  it('every tooth has its own place in the chart order', () => {
    const all = [...ADULT_UPPER, ...ADULT_LOWER, ...KIDS_UPPER, ...KIDS_LOWER]
    expect(new Set(all.map(toothOrder)).size).toBe(52)
    expect(Math.min(...all.map(toothOrder))).toBe(0)
    expect(Math.max(...all.map(toothOrder))).toBe(51)
    expect(new Set(all.map(toothLabel)).size).toBe(52 - 0) // 32 numbers + 20 letters
  })
  it('lists teeth in chart order', () => {
    expect(teethText([48, 55, 16, 21])).toBe('3 · 9 · 32 · A')
  })
})
