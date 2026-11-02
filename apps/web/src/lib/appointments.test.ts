import { describe, expect, it } from 'vitest'
import { awaitingReply, countByStatus, filterDay } from './appointments.ts'
import type { AppointmentStatus } from './appointments.ts'

const A = (status: AppointmentStatus, startsAt = '2026-11-02T08:00:00Z') => ({ status, startsAt })
const day = [A('PENDING'), A('CONFIRMED'), A('CONFIRMED'), A('COMPLETED'), A('CANCELLED'), A('CANCELLED')]

describe('day cards', () => {
  it('counts every status', () => {
    expect(countByStatus(day)).toEqual({ PENDING: 1, CONFIRMED: 2, COMPLETED: 1, CANCELLED: 2 })
    expect(countByStatus([])).toEqual({ PENDING: 0, CONFIRMED: 0, COMPLETED: 0, CANCELLED: 0 })
  })
  it('"all" hides the cancelled; each card shows only its own status', () => {
    expect(filterDay(day, 'ALL')).toHaveLength(4)
    expect(filterDay(day, 'CONFIRMED')).toHaveLength(2)
    expect(filterDay(day, 'COMPLETED')).toHaveLength(1)
    expect(filterDay(day, 'CANCELLED')).toHaveLength(2)
    expect(filterDay(day, 'PENDING')).toHaveLength(1)
  })
})

describe('waiting for the patient to answer', () => {
  it('lists only pending ones, soonest first (a missed one comes first)', () => {
    const list = [A('PENDING', '2026-11-05T08:00:00Z'), A('CONFIRMED', '2026-11-01T08:00:00Z'), A('PENDING', '2026-10-30T08:00:00Z'), A('CANCELLED', '2026-11-03T08:00:00Z')]
    expect(awaitingReply(list).map((a) => a.startsAt)).toEqual(['2026-10-30T08:00:00Z', '2026-11-05T08:00:00Z'])
  })
})
