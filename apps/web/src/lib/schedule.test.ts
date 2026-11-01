import { describe, expect, it } from 'vitest'
import { addDays, dayRange, freeStarts, instantAt, isDate, localParts, minuteLabel, periodsFromWeek, timeLabel, weekdayOf, weekFromPeriods, weekStart } from './schedule.ts'

const MON = '2026-11-09' // a Monday, winter time (UTC+2)
const periods = [
  { weekday: 1, startMinute: 540, endMinute: 660 }, // 09:00-11:00
  { weekday: 1, startMinute: 960, endMinute: 1020 }, // 16:00-17:00
]
const before = new Date('2026-11-01T00:00:00Z')

describe('clinic time', () => {
  it('reads the clinic wall clock, winter and summer', () => {
    expect(localParts('2026-01-15T07:00:00Z')).toEqual({ date: '2026-01-15', weekday: 4, minute: 540 })
    expect(localParts('2026-07-16T06:00:00Z')).toEqual({ date: '2026-07-16', weekday: 4, minute: 540 })
    expect(localParts('2026-11-08T22:30:00Z')).toEqual({ date: '2026-11-09', weekday: 1, minute: 30 }) // crosses midnight
  })
  it('instantAt is the exact inverse, in both seasons', () => {
    for (const [d, m] of [['2026-01-15', 540], ['2026-07-16', 540], ['2026-11-09', 0], ['2026-11-09', 1410]] as const) {
      const p = localParts(instantAt(d, m))
      expect([p.date, p.minute]).toEqual([d, m])
    }
    expect(instantAt('2026-01-15', 540).toISOString()).toBe('2026-01-15T07:00:00.000Z')
  })
  it('a day range is 24h in winter', () => {
    const r = dayRange(MON)
    expect((Date.parse(r.to) - Date.parse(r.from)) / 3_600_000).toBe(24)
  })
  it('date helpers', () => {
    expect(weekdayOf(MON)).toBe(1)
    expect(weekStart(MON)).toBe('2026-11-08')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(isDate('2026-02-31')).toBe(false)
    expect(isDate('2026-02-28')).toBe(true)
    expect(minuteLabel(570)).toBe('09:30')
    expect(timeLabel('2026-01-15T07:30:00Z')).toBe('09:30')
  })
})

describe('freeStarts', () => {
  it('lists every half hour that fits a 30-minute visit', () => {
    expect(freeStarts({ date: MON, periods, busy: [], duration: 30, now: before })).toEqual([540, 570, 600, 630, 960, 990])
  })
  it('a 60-minute visit must fit before the period ends', () => {
    expect(freeStarts({ date: MON, periods, busy: [], duration: 60, now: before })).toEqual([540, 570, 600, 960])
  })
  it('a booking of 30 min at 09:00 makes 09:30 the next free time', () => {
    const busy = [{ startsAt: instantAt(MON, 540).toISOString(), endsAt: instantAt(MON, 570).toISOString(), status: 'PENDING' }]
    expect(freeStarts({ date: MON, periods, busy, duration: 30, now: before })).toEqual([570, 600, 630, 960, 990])
    expect(freeStarts({ date: MON, periods, busy, duration: 60, now: before })).toEqual([570, 600, 960])
  })
  it('cancelled appointments free the slot; the appointment being moved ignores itself', () => {
    const b = { id: 'x', startsAt: instantAt(MON, 540).toISOString(), endsAt: instantAt(MON, 600).toISOString(), status: 'CANCELLED' }
    expect(freeStarts({ date: MON, periods, busy: [b], duration: 30, now: before })).toContain(540)
    expect(freeStarts({ date: MON, periods, busy: [{ ...b, status: 'CONFIRMED' }], duration: 30, now: before, ignoreId: 'x' })).toContain(540)
  })
  it('hides the past and days without hours', () => {
    const now = instantAt(MON, 620)
    expect(freeStarts({ date: MON, periods, busy: [], duration: 30, now })).toEqual([600, 630, 960, 990]) // 10:00 still running (30 min grace)
    expect(freeStarts({ date: '2026-11-10', periods, busy: [], duration: 30, now: before })).toEqual([])
  })
})

describe('working hours editor', () => {
  it('round-trips and validates', () => {
    expect(weekFromPeriods(periods)[1]).toEqual([{ start: 540, end: 660 }, { start: 960, end: 1020 }])
    const w = weekFromPeriods(periods)
    expect(periodsFromWeek(w)).toEqual({ ok: true, periods })
    w[1] = [{ start: 540, end: 660 }, { start: 600, end: 700 }]
    expect(periodsFromWeek(w).ok).toBe(false)
    w[1] = [{ start: 600, end: 600 }]
    expect(periodsFromWeek(w).ok).toBe(false)
  })
})
