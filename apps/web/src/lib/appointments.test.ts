import { describe, expect, it } from 'vitest'
import { awaitingReply, confirmedOnly, countByStatus, filterDay, finishedOnOtherDay, messageLine } from './appointments.ts'
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

describe('opening a treatment on an appointment', () => {
  it('offers only the confirmed ones, soonest first', () => {
    const list = [A('CONFIRMED', '2026-11-02T10:00:00Z'), A('PENDING', '2026-11-02T07:00:00Z'), A('COMPLETED', '2026-11-02T06:00:00Z'), A('CANCELLED', '2026-11-02T05:00:00Z'), A('CONFIRMED', '2026-11-02T08:00:00Z')]
    expect(confirmedOnly(list).map((a) => a.startsAt)).toEqual(['2026-11-02T08:00:00Z', '2026-11-02T10:00:00Z'])
  })
  it('says when a visit finished on another day than booked', () => {
    const day = (iso: string) => iso.slice(0, 10)
    expect(finishedOnOtherDay({ status: 'COMPLETED', startsAt: '2026-11-03T08:00:00Z', completedAt: '2026-11-02T09:00:00Z' }, day)).toBe('2026-11-02')
    expect(finishedOnOtherDay({ status: 'COMPLETED', startsAt: '2026-11-02T08:00:00Z', completedAt: '2026-11-02T09:00:00Z' }, day)).toBeNull()
    expect(finishedOnOtherDay({ status: 'CONFIRMED', startsAt: '2026-11-03T08:00:00Z', completedAt: null }, day)).toBeNull()
  })
})

describe('WhatsApp line on the card', () => {
  const when = (iso: string) => `@${iso}`
  const msg = (o: object) => ({ status: 'SENT', sentAt: 'S', scheduledFor: null, response: null, respondedAt: null, errorMessage: null, body: 'x', ...o }) as never
  it('shows when the message will go out while it is still ahead', () => {
    expect(messageLine({ status: 'PENDING', confirmationMessage: null, messageDueAt: 'D' }, when)).toEqual({ text: 'بتنرسل رسالة التأكيد @D', tone: 'warn' })
  })
  it('shows nothing for an appointment that never gets a message', () => {
    expect(messageLine({ status: 'CONFIRMED', confirmationMessage: null, messageDueAt: null }, when)).toBeNull()
    expect(messageLine({ status: 'COMPLETED', confirmationMessage: msg({}), messageDueAt: null }, when)).toBeNull()
  })
  it('sent and waiting for the patient', () => {
    expect(messageLine({ status: 'PENDING', confirmationMessage: msg({}), messageDueAt: null }, when)).toEqual({ text: 'انرسلت رسالة التأكيد @S · بانتظار رد المريض', tone: 'info' })
  })
  it('shows the answer', () => {
    expect(messageLine({ status: 'CONFIRMED', confirmationMessage: msg({ response: 'YES' }), messageDueAt: null }, when)?.tone).toBe('good')
    expect(messageLine({ status: 'CANCELLED', confirmationMessage: msg({ response: 'NO' }), messageDueAt: null }, when)?.tone).toBe('bad')
  })
  it('shows a failure, and nothing extra on a cancelled one without an answer', () => {
    expect(messageLine({ status: 'PENDING', confirmationMessage: msg({ status: 'FAILED' }), messageDueAt: null }, when)).toEqual({ text: 'فشل إرسال رسالة التأكيد', tone: 'bad' })
    expect(messageLine({ status: 'CANCELLED', confirmationMessage: msg({}), messageDueAt: null }, when)).toBeNull()
  })
})
