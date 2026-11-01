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
