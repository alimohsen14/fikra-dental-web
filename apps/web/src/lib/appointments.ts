import { request } from './api.ts'
import type { Period } from './schedule.ts'

export type AppointmentStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED'

export interface Appointment {
  id: string
  startsAt: string
  endsAt: string
  status: AppointmentStatus
  notes: string | null
  cancelReason: string | null
  durationMinutes: number
  overdue: boolean
  patient: { id: string; fullName: string; phone: string; medicalAlerts: string | null }
  doctor: { id: string; fullName: string }
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

/** Appointments still waiting for the patient to answer, soonest first. The doctor calls them: coming = confirm, not coming = cancel (the time is free again). */
export const awaitingReply = <T extends Pick<Appointment, 'status' | 'startsAt'>>(list: T[]): T[] => list.filter((a) => a.status === 'PENDING').sort((a, b) => a.startsAt.localeCompare(b.startsAt))

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
export const completeAppointment = (id: string) => request<Appointment>(`/appointments/${id}/complete`, { method: 'POST' })
export const cancelAppointment = (id: string, reason?: string) => request<Appointment>(`/appointments/${id}/cancel`, { method: 'POST', body: reason ? { reason } : {} })
