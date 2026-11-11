import { describe, expect, it } from 'vitest'
import { awaitingReply, confirmedOnly, countByStatus, doctorDays, filterDay, finishedOnOtherDay, messageLine } from './appointments.ts'
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

describe('doctorDays', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 10, 11, h)).toISOString()
  const apt = (doctorId: string, status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED', h: number) => ({ status, startsAt: at(h), endsAt: at(h + 1), doctor: { id: doctorId, fullName: doctorId } })
  const docs = [{ id: 'a', fullName: 'A' }, { id: 'b', fullName: 'B' }]
  const now = Date.parse(at(10)) + 60_000

  it('counts per doctor, skips cancelled ones and finds the next one still to come', () => {
    const r = doctorDays(docs, [apt('a', 'COMPLETED', 8), apt('a', 'CONFIRMED', 12), apt('a', 'PENDING', 14), apt('a', 'CANCELLED', 9), apt('b', 'CONFIRMED', 10)], now)
    expect(r[0]).toMatchObject({ total: 3, completed: 1, next: at(12) })
    // B's only appointment started at 10:00 and is still going at 10:01, so it is not "next" any more once it ends; it has not ended yet
    expect(r[1]).toMatchObject({ total: 1, completed: 0, next: at(10) })
  })
  it('a doctor with nothing today still gets a card', () => {
    expect(doctorDays(docs, [], now)).toEqual([{ doctor: docs[0], total: 0, completed: 0, next: null }, { doctor: docs[1], total: 0, completed: 0, next: null }])
  })
  it('appointments that are over and never finished are not "next"', () => {
    expect(doctorDays(docs, [apt('a', 'PENDING', 8)], now)[0].next).toBeNull()
  })
})
