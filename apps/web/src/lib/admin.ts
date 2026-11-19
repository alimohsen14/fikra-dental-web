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
  termsAcceptedVersion: string | null
  termsAcceptedAt: string | null
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
  method: PayMethod
  cheque: { id: string; status: SubChequeStatus; dueDate: string; chequeNumber: string | null } | null
}

export type PayMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER' | 'CHEQUE'
export const PAY_METHODS: PayMethod[] = ['CASH', 'CHEQUE'] // the only two ways to pay now; older payments may carry another method (still labeled)
export const PAY_METHOD_LABELS: Record<PayMethod, string> = { CASH: 'نقداً', TRANSFER: 'تحويل بنكي', CARD: 'بطاقة', OTHER: 'أخرى', CHEQUE: 'شك' }

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
export interface SubChequeInput {
  dueDate: string
  chequeNumber?: string
  bankName?: string
  accountNumber?: string
  drawerName?: string
  drawerPhone?: string
  notes?: string
}
export const addPayment = (id: string, body: { amount: number; paidAt?: string; periodId?: string; note?: string; method?: PayMethod; cheque?: SubChequeInput }) =>
  request<Billing & { createdChequeId: string | null }>(`/admin/clinics/${id}/payments`, { method: 'POST', body })
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

// ---- cheques clinics paid with (incoming only) and the platform's cash page
export type SubChequeStatus = 'PENDING' | 'CASHED' | 'RETURNED' | 'CANCELLED'
export const SUB_CHEQUE_LABELS: Record<SubChequeStatus, string> = { PENDING: 'لم يُصرف بعد', CASHED: 'مصروف', RETURNED: 'مرتجع', CANCELLED: 'ملغى' }
export const SUB_CHEQUE_STYLE: Record<SubChequeStatus, { bg: string; fg: string }> = {
  PENDING: { bg: '#fff1d6', fg: '#7a4a00' },
  CASHED: { bg: '#e3f5ea', fg: '#0b6b3a' },
  RETURNED: { bg: '#fde8e8', fg: '#9b1c1c' },
  CANCELLED: { bg: '#e8ecf1', fg: '#3d4b60' },
}
export interface SubCheque {
  id: string
  clinic: { id: string; name: string }
  status: SubChequeStatus
  amount: number
  dueDate: string
  due: 'later' | 'today' | 'overdue' | 'done'
  chequeNumber: string | null
  bankName: string | null
  accountNumber: string | null
  drawerName: string | null
  drawerPhone: string | null
  notes: string | null
  hasImage: boolean
  cashedAt: string | null
  returnedAt: string | null
  returnReason: string | null
  createdAt: string
}
export interface Sum {
  amount: number
  count: number
}
export interface SubChequeList {
  items: SubCheque[]
  totals: { pending: Sum; dueToday: Sum; overdue: Sum; cashed: Sum; returned: Sum }
}
export const listSubCheques = (status: SubChequeStatus | 'ALL', q: string) => {
  const p = [status !== 'ALL' ? `status=${status}` : '', q.trim() ? `q=${encodeURIComponent(q.trim())}` : ''].filter(Boolean).join('&')
  return request<SubChequeList>('/admin/cheques' + (p ? `?${p}` : ''))
}
export const getSubCheque = (id: string) => request<SubCheque>(`/admin/cheques/${id}`)
export const cashSubCheque = (id: string) => request<SubCheque>(`/admin/cheques/${id}/cash`, { method: 'POST' })
export const returnSubCheque = (id: string, reason: string) => request<SubCheque>(`/admin/cheques/${id}/return`, { method: 'POST', body: { reason } })
export const uploadSubChequeImage = (id: string, image: Blob) => request<SubCheque>(`/admin/cheques/${id}/image`, { method: 'POST', file: image })
export const fetchSubChequeImage = (id: string) => request<Blob>(`/admin/cheques/${id}/image`, { blob: true })

export interface CashRow {
  id: string
  clinic: { id: string; name: string }
  amount: number
  method: PayMethod
  at: string
  note: string | null
  fromCheque: boolean
  chequeNumber: string | null
}
export interface CashPage {
  from: string
  to: string
  total: number
  fromCheques: number
  items: CashRow[]
}
export const getCashPage = (from: string, to: string) => request<CashPage>(`/admin/cash?from=${from}&to=${to}`)
