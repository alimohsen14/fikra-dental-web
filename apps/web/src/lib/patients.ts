import { request } from './api.ts'

export type Gender = 'MALE' | 'FEMALE'

export interface Patient {
  id: string
  fullName: string
  phone: string // international format, e.g. +970599123456
  nationalId: string | null
  birthDate: string | null
  gender: Gender | null
  region: string | null
  address: string | null
  notes: string | null
  medicalAlerts: string | null
  archivedAt: string | null
  createdAt: string
}

export interface PatientPage {
  items: Patient[]
  total: number
  page: number
  pageSize: number
}

export const PAGE_SIZE = 20
export const GENDER_LABELS: Record<Gender, string> = { MALE: 'ذكر', FEMALE: 'أنثى' }

export const listPatients = (p: { q: string; page: number; archived: boolean }) => {
  const qs = new URLSearchParams({ page: String(p.page), pageSize: String(PAGE_SIZE), archived: String(p.archived) })
  if (p.q) qs.set('q', p.q)
  return request<PatientPage>(`/patients?${qs}`)
}
export const getPatient = (id: string) => request<Patient>(`/patients/${id}`)
export const createPatient = (body: Record<string, string>) =>
  request<{ patient: Patient; sharedPhoneWith: { id: string; fullName: string }[] }>('/patients', { method: 'POST', body })
export const updatePatient = (id: string, body: Record<string, string>) => request<Patient>(`/patients/${id}`, { method: 'PATCH', body })
export const setPatientArchived = (id: string, archived: boolean) => request<Patient>(`/patients/${id}/${archived ? 'archive' : 'unarchive'}`, { method: 'POST' })
