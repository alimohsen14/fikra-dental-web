import { request } from './api.ts'
import type { Period } from './schedule.ts'

export type AppointmentStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED'

export interface ConfirmationMessage {
  status: 'SCHEDULED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'CANCELLED'
  sentAt: string | null
  scheduledFor: string | null
  response: 'YES' | 'NO' | null
  respondedAt: string | null
  errorMessage: string | null
  body: string | null
}

export interface Appointment {
  id: string
  startsAt: string
  endsAt: string
  status: AppointmentStatus
  notes: string | null
  cancelReason: string | null
  completedAt: string | null
  durationMinutes: number
  overdue: boolean
  patient: { id: string; fullName: string; phone: string; medicalAlerts: string | null; selfRegistered?: boolean }
  doctor: { id: string; fullName: string }
  bookedByPatient?: boolean
  confirmationMessage?: ConfirmationMessage | null
  /** when the confirmation message will go out (only while it has not been sent) */
  messageDueAt?: string | null
}

export interface Doctor {
  id: string
  fullName: string
  specialty: string | null
  userId: string | null
  workingPeriods: (Period & { id: string })[]
}

export const STATUS_LABELS: Record<AppointmentStatus, string> = { PENDING: 'بانتظار التأكيد', CONFIRMED: 'مؤكد', COMPLETED: 'منتهي', CANCELLED: 'ملغي' }
export const STATUS_STYLE: Record<AppointmentStatus, { bg: string; fg: string }> = {
  PENDING: { bg: '#fff1d6', fg: '#7a4b00' },
  CONFIRMED: { bg: '#e3eefb', fg: '#033f8c' },
  COMPLETED: { bg: '#e3f5ea', fg: '#0b4f2c' },
  CANCELLED: { bg: '#eceff3', fg: '#4a5a70' },
}

/** The cards above a day: all (without cancelled), or one status. */
export type DayFilter = 'ALL' | AppointmentStatus

export function countByStatus(list: Pick<Appointment, 'status'>[]): Record<AppointmentStatus, number> {
  const n: Record<AppointmentStatus, number> = { PENDING: 0, CONFIRMED: 0, COMPLETED: 0, CANCELLED: 0 }
  for (const a of list) n[a.status] += 1
  return n
}

export const filterDay = <T extends Pick<Appointment, 'status'>>(list: T[], f: DayFilter): T[] => (f === 'ALL' ? list.filter((a) => a.status !== 'CANCELLED') : list.filter((a) => a.status === f))

/** What the doctor can open a treatment on: confirmed appointments only (not waiting, finished or cancelled), soonest first. */
export const confirmedOnly = <T extends Pick<Appointment, 'status' | 'startsAt'>>(list: T[]): T[] => list.filter((a) => a.status === 'CONFIRMED').sort((a, b) => a.startsAt.localeCompare(b.startsAt))

/** A visit finished on another day than booked (the patient came earlier): returns the day it really happened, else null. */
export function finishedOnOtherDay(a: Pick<Appointment, 'status' | 'startsAt' | 'completedAt'>, dayOf: (iso: string) => string): string | null {
  if (a.status !== 'COMPLETED' || !a.completedAt) return null
  const done = dayOf(a.completedAt)
  return done === dayOf(a.startsAt) ? null : done
}

/** Appointments still waiting for the patient to answer, soonest first. The doctor calls them: coming = confirm, not coming = cancel (the time is free again). */
export const awaitingReply = <T extends Pick<Appointment, 'status' | 'startsAt'>>(list: T[]): T[] => list.filter((a) => a.status === 'PENDING').sort((a, b) => a.startsAt.localeCompare(b.startsAt))

export interface MessageLine {
  text: string
  tone: 'info' | 'good' | 'bad' | 'warn'
}

/** The one line on the card about the WhatsApp confirmation: sent, answered, failed, or when it will go out. */
export function messageLine(a: Pick<Appointment, 'status' | 'confirmationMessage' | 'messageDueAt'>, when: (iso: string) => string): MessageLine | null {
  if (a.status !== 'PENDING' && a.status !== 'CONFIRMED' && a.status !== 'CANCELLED') return null
  const m = a.confirmationMessage
  if (m) {
    if (m.response === 'YES') return { text: 'المريض ردّ بواتساب: نعم، بيجي', tone: 'good' }
    if (m.response === 'NO') return { text: 'المريض ردّ بواتساب: لا، ما بيجي', tone: 'bad' }
    if (a.status === 'CANCELLED') return null
    if (m.status === 'FAILED') return { text: 'فشل إرسال رسالة التأكيد', tone: 'bad' }
    if (m.status === 'SCHEDULED') return { text: 'رسالة التأكيد قيد الإرسال', tone: 'info' }
    return { text: `انرسلت رسالة التأكيد ${m.sentAt ? when(m.sentAt) : ''}${a.status === 'PENDING' ? ' · بانتظار رد المريض' : ''}`.trim(), tone: 'info' }
  }
  if (a.status === 'PENDING' && a.messageDueAt) return { text: `بتنرسل رسالة التأكيد ${when(a.messageDueAt)}`, tone: 'warn' }
  return null
}

export const getWhatsappStatus = () => request<{ provider: string; testMode: boolean; windowHours: number }>('/whatsapp/status')
export const sendMessageNow = (id: string) => request<{ status: string }>(`/appointments/${id}/message/send-now`, { method: 'POST' })
export const testReply = (id: string, answer: 'YES' | 'NO') => request<{ ok: true }>(`/appointments/${id}/message/reply`, { method: 'POST', body: { answer } })

export const listDoctors = () => request<Doctor[]>('/doctors')
export const setWorkingPeriods = (doctorId: string, periods: Period[]) =>
  request<(Period & { id: string })[]>(`/doctors/${doctorId}/working-periods`, { method: 'PUT', body: { periods } })

export const listAppointments = (p: { from: string; to: string; doctorId?: string }) => {
  const qs = new URLSearchParams({ from: p.from, to: p.to })
  if (p.doctorId) qs.set('doctorId', p.doctorId)
  return request<Appointment[]>(`/appointments?${qs}`)
}
export const createAppointment = (body: { patientId: string; doctorId: string; startsAt: string; durationMinutes: number; notes?: string }) =>
  request<Appointment>('/appointments', { method: 'POST', body })
export const updateAppointment = (id: string, body: { doctorId?: string; startsAt?: string; durationMinutes?: number; notes?: string | null }) =>
  request<Appointment>(`/appointments/${id}`, { method: 'PATCH', body })
export const confirmAppointment = (id: string) => request<Appointment>(`/appointments/${id}/confirm`, { method: 'POST' })
export const cancelAppointment = (id: string, reason?: string) => request<Appointment>(`/appointments/${id}/cancel`, { method: 'POST', body: reason ? { reason } : {} })

export interface DoctorDay {
  doctor: { id: string; fullName: string }
  total: number
  completed: number
  /** start of the next appointment still to come (pending or confirmed, not yet over), if any */
  next: string | null
}

/** One summary per doctor for the appointments of a day. Cancelled ones do not count. */
export function doctorDays(doctors: { id: string; fullName: string }[], list: Pick<Appointment, 'status' | 'startsAt' | 'endsAt' | 'doctor'>[], now: number): DoctorDay[] {
  return doctors.map((doctor) => {
    const mine = list.filter((a) => a.doctor.id === doctor.id && a.status !== 'CANCELLED')
    const upcoming = mine
      .filter((a) => (a.status === 'PENDING' || a.status === 'CONFIRMED') && Date.parse(a.endsAt) > now)
      .map((a) => a.startsAt)
      .sort()
    return { doctor, total: mine.length, completed: mine.filter((a) => a.status === 'COMPLETED').length, next: upcoming[0] ?? null }
  })
}
