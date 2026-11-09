// The platform-admin API (/admin/...). Money is in agorot.
import { request } from './api.ts'
import type { Role } from './session.ts'

export type ClinicState = 'ACTIVE' | 'GRACE' | 'EXPIRED' | 'SUSPENDED'
export type BillingStatus = 'NONE' | 'UNPAID' | 'PARTIAL' | 'PAID'

export interface BillingSummary {
  status: BillingStatus
  totalPrice: number
  totalPaid: number
  totalRemaining: number
}

export interface ClinicRow {
  id: string
  name: string
  status: 'ACTIVE' | 'SUSPENDED'
  subscriptionEndsAt: string | null
  state: ClinicState
  graceDaysLeft: number | null
  daysSinceEnd: number | null
  createdAt: string
  owner: { id: string; username: string; fullName: string } | null
  billing: BillingSummary
  usersCount: number
  patientsCount: number
}

export interface ClinicList {
  summary: { total: number; active: number; grace: number; expired: number; suspended: number; unpaid: number }
  items: ClinicRow[]
}

export interface ClinicUser {
  id: string
  username: string
  fullName: string
  role: Role
  isActive: boolean
  mustChangePassword: boolean
  lockedUntil: string | null
  createdAt: string
}

export interface ClinicDetail {
  id: string
  name: string
  logoUrl: string | null
  themeColor: string | null
  status: 'ACTIVE' | 'SUSPENDED'
  subscriptionEndsAt: string | null
  createdAt: string
  users: ClinicUser[]
  state: ClinicState
  graceDaysLeft: number | null
  daysSinceEnd: number | null
  patientsCount: number
  billing: BillingSummary
}

export interface Payment {
  id: string
  amount: number
  paidAt: string
  note: string | null
  voided: boolean
  voidedAt: string | null
  voidReason: string | null
}

export interface Period {
  id: string
  months: number
  startsAt: string
  endsAt: string
  price: number
  paid: number
  remaining: number
  status: BillingStatus
  payments: Payment[]
}

export interface Billing extends BillingSummary {
  periods: Period[]
}

/** Shown ONCE: the server never stores or returns the plain password again. */
export interface TempCredentials {
  owner: { id: string; username: string; fullName: string }
  temporaryPassword: string
  temporaryPasswordExpiresAt: string
}

export interface CreateClinicInput {
  name: string
  subscription: { months: number; price: number }
  owner: { fullName: string; username: string; phone?: string; specialty?: string }
}

export const listClinics = (q: string) => request<ClinicList>('/admin/clinics' + (q ? `?q=${encodeURIComponent(q)}` : ''))
export const getClinic = (id: string) => request<ClinicDetail>(`/admin/clinics/${id}`)
export const createClinic = (input: CreateClinicInput) =>
  request<TempCredentials & { clinic: { id: string; name: string } }>('/admin/clinics', { method: 'POST', body: input })
export const updateClinic = (id: string, body: { name: string }) =>
  request<unknown>(`/admin/clinics/${id}`, { method: 'PATCH', body })
export const setClinicActive = (id: string, active: boolean, reason?: string) =>
  request<ClinicDetail>(`/admin/clinics/${id}/${active ? 'activate' : 'suspend'}`, { method: 'POST', body: reason ? { reason } : {} })
export const renewClinic = (id: string, body: { months: number; price?: number } | { endsAt: string; price?: number }) =>
  request<ClinicDetail>(`/admin/clinics/${id}/renew`, { method: 'POST', body })
export const resetOwnerPassword = (id: string) => request<TempCredentials>(`/admin/clinics/${id}/reset-owner-password`, { method: 'POST' })
export const getBilling = (id: string) => request<Billing>(`/admin/clinics/${id}/billing`)
export const addPayment = (id: string, body: { amount: number; paidAt?: string; periodId?: string; note?: string }) =>
  request<Billing>(`/admin/clinics/${id}/payments`, { method: 'POST', body })
export const voidPayment = (id: string, paymentId: string, reason: string) =>
  request<Billing>(`/admin/clinics/${id}/payments/${paymentId}/void`, { method: 'POST', body: { reason } })

export interface WhatsappSettings {
  configured: boolean
  phoneNumberId: string | null
  businessAccountId: string | null
  updatedAt: string | null
}
export const getWhatsapp = (id: string) => request<WhatsappSettings>(`/admin/clinics/${id}/whatsapp`)
export const saveWhatsapp = (id: string, body: { phoneNumberId: string; businessAccountId: string | null; accessToken?: string }) =>
  request<WhatsappSettings>(`/admin/clinics/${id}/whatsapp`, { method: 'PUT', body })
export const removeWhatsapp = (id: string) => request<WhatsappSettings>(`/admin/clinics/${id}/whatsapp`, { method: 'DELETE' })
