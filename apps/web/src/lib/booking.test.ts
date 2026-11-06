import { describe, expect, it } from 'vitest'
import { bookedNote, groupByMonth, tokenFromLink } from './booking.ts'

describe('booking page helpers', () => {
  it('takes the token from the link whatever the host', () => {
    expect(tokenFromLink('http://localhost:5173/book/abc_DEF-123')).toBe('abc_DEF-123')
    expect(tokenFromLink('https://clinic.example.com/book/xyz')).toBe('xyz')
    expect(tokenFromLink('nothing')).toBe('')
  })
  it('tells a confirmed booking from one that waits for the reminder', () => {
    expect(bookedNote('CONFIRMED')).toContain('مؤكد')
    expect(bookedNote('PENDING')).toContain('تذكير')
  })
  it('groups days by month in order', () => {
    const d = (date: string) => ({ date, count: 1 })
    expect(groupByMonth([d('2026-11-28'), d('2026-11-30'), d('2026-12-02')]).map((g) => [g.month, g.days.length])).toEqual([['2026-11', 2], ['2026-12', 1]])
    expect(groupByMonth([])).toEqual([])
  })
})
