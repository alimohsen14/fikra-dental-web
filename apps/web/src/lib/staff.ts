import { request } from './api.ts'

export type StaffRole = 'OWNER' | 'DOCTOR' | 'SECRETARY'

export interface StaffMember {
  id: string
  username: string
  fullName: string
  phone: string | null
  role: StaffRole
  isActive: boolean
  canManagePayments: boolean
  mustChangePassword: boolean
  createdAt: string
  doctor: { id: string; specialty: string | null; isActive: boolean } | null
}

export interface StaffSecret {
  staff: StaffMember
  temporaryPassword: string
  temporaryPasswordExpiresAt: string
}

export interface CreateStaffInput {
  username: string
  fullName: string
  role: 'DOCTOR' | 'SECRETARY'
  phone?: string
  specialty?: string
  canManagePayments?: boolean
}

export interface UpdateStaffInput {
  fullName?: string
  phone?: string | null
  specialty?: string | null
  canManagePayments?: boolean
}

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = { OWNER: 'مالك', DOCTOR: 'دكتور', SECRETARY: 'سكرتارية' }

export const listStaff = () => request<StaffMember[]>('/staff')
export const createStaff = (body: CreateStaffInput) => request<StaffSecret>('/staff', { method: 'POST', body })
export const updateStaff = (id: string, body: UpdateStaffInput) => request<StaffMember>(`/staff/${id}`, { method: 'PATCH', body })
export const deactivateStaff = (id: string) => request<{ staff: StaffMember; upcomingAppointments: number }>(`/staff/${id}/deactivate`, { method: 'POST' })
export const activateStaff = (id: string) => request<{ staff: StaffMember }>(`/staff/${id}/activate`, { method: 'POST' })
export const resetStaffPassword = (id: string) => request<StaffSecret>(`/staff/${id}/reset-password`, { method: 'POST' })
