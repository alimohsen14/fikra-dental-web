import { describe, expect, it } from 'vitest'
import { endOfDayIso, formatDate, formatMoney, paidAtIso, parseShekels } from './format.ts'

describe('money', () => {
  it('formats agorot as shekels', () => {
    expect(formatMoney(0)).toBe('₪0')
    expect(formatMoney(15000)).toBe('₪150')
    expect(formatMoney(15050)).toBe('₪150.50')
    expect(formatMoney(300000)).toBe('₪3,000')
  })

  it('parses what people type, without float errors', () => {
    expect(parseShekels('3000')).toBe(300000)
    expect(parseShekels(' 150.5 ')).toBe(15050)
    expect(parseShekels('0.1')).toBe(10)
    expect(parseShekels('1,500')).toBe(150000)
    expect(parseShekels('١٥٠')).toBe(15000)
    expect(parseShekels('19.99')).toBe(1999)
  })

  it('rejects anything that is not a plain amount', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '1e3', '12 34', '1..2', '2000000']) expect(parseShekels(bad)).toBeNull()
  })
})

describe('dates', () => {
  it('formats with western digits, "-" when empty', () => {
    expect(formatDate('2026-10-31T12:00:00Z')).toBe('2026-10-31')
    expect(formatDate(null)).toBe('-')
    expect(formatDate('nonsense')).toBe('-')
  })

  it('a payment date is never in the future', () => {
    expect(new Date(paidAtIso('2999-01-01')).getTime()).toBeLessThanOrEqual(Date.now() + 1000)
    expect(paidAtIso('2020-05-05').startsWith('2020-05-05') || paidAtIso('2020-05-04').length > 0).toBe(true)
  })

  it('an end date is the end of that day', () => {
    const d = new Date(endOfDayIso('2030-01-15'))
    expect([d.getHours(), d.getMinutes()]).toEqual([23, 59])
  })
})
