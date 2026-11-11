import { request } from './api.ts'

export interface PatientBalance {
  patientId: string
  fullName: string
  phone: string
  total: number
  paid: number
  remaining: number
  openTreatments: number
  lastPaidAt: string | null
}
export interface Balances {
  items: PatientBalance[]
  totalRemaining: number
}

export const getBalances = (mine = false) => request<Balances>(`/patient-balances${mine ? '?mine=true' : ''}`)

/** Search by name or phone; the order from the server (biggest debt first) is kept. */
export function filterBalances(items: PatientBalance[], q: string): PatientBalance[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return items
  const digits = needle.replace(/\D/g, '')
  return items.filter((i) => i.fullName.toLowerCase().includes(needle) || (digits.length > 0 && i.phone.replace(/\D/g, '').includes(digits)))
}
