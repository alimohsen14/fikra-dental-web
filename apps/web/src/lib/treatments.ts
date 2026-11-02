import { request } from './api.ts'
import type { AppointmentStatus } from './appointments.ts'
import { toothOrder } from './teeth.ts'

export type TreatmentStatus = 'OPEN' | 'CLOSED' | 'CANCELLED'
export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER'

export interface TreatmentType {
  id: string
  name: string
  isActive: boolean
  parentId: string | null
}

export interface SessionRow {
  id: string
  number: number
  status: 'PLANNED' | 'COMPLETED'
  completedAt: string | null
  notes: string | null
  appointmentId: string | null
  appointment: { id: string; startsAt: string; endsAt: string; status: AppointmentStatus } | null
}

export interface PaymentRow {
  id: string
  amount: number
  method: PaymentMethod
  paidAt: string
  note: string | null
  status: 'ACTIVE' | 'VOIDED'
  voidedAt: string | null
  voidReason: string | null
  createdAt: string
}

export interface TypeRef {
  id: string
  name: string
  parent: { id: string; name: string } | null
}

export interface ToothTreatment {
  toothCode: number
  treatmentTypeId: string
  treatmentType: TypeRef
}

export interface Treatment {
  id: string
  patientId: string
  doctorId: string
  appointmentId: string | null
  description: string | null
  totalCost: number
  plannedSessions: number
  status: TreatmentStatus
  startedAt: string
  closedAt: string | null
  createdAt: string
  doctor: { id: string; fullName: string }
  patient: { id: string; fullName: string }
  toothCodes: number[]
  teeth: ToothTreatment[] // every tooth with its own type; cost and sessions belong to the whole treatment
  sessions: SessionRow[]
  // Only for the owner and accounts with the payments key:
  paid?: number
  remaining?: number
  payments?: PaymentRow[]
}

export interface PatientFinance {
  treatments: number
  openTreatments: number
  total: number
  paid: number
  remaining: number
}

export const STATUS_TEXT: Record<TreatmentStatus, string> = { OPEN: 'مفتوح', CLOSED: 'مغلق', CANCELLED: 'ملغي' }
export const TREATMENT_STYLE: Record<TreatmentStatus, { bg: string; fg: string }> = {
  OPEN: { bg: '#fff1d6', fg: '#7a4b00' },
  CLOSED: { bg: '#e3f5ea', fg: '#0b4f2c' },
  CANCELLED: { bg: '#eceff3', fg: '#4a5a70' },
}
export const METHOD_LABELS: Record<PaymentMethod, string> = { CASH: 'نقداً', CARD: 'بطاقة', TRANSFER: 'تحويل', OTHER: 'أخرى' }

// ---------------------------------------------------------------- helpers
/** "تلبيسة › زركون" for a sub-type, just the name for a top-level type. */
export const typeLabel = (t: TypeRef): string => (t.parent ? `${t.parent.name} › ${t.name}` : t.name)

/** The different types a treatment uses, in tooth order ("حشوة" twice shows once). */
export function typeLabels(t: Pick<Treatment, 'teeth'>): string[] {
  return [...new Set([...t.teeth].sort((a, b) => toothOrder(a.toothCode) - toothOrder(b.toothCode)).map((x) => typeLabel(x.treatmentType)))]
}

export interface TypeNode {
  type: TreatmentType
  children: TreatmentType[]
}

/** Types as a two-level tree. Sub-types whose parent is missing are ignored. */
export function typeTree(types: TreatmentType[]): TypeNode[] {
  const top = types.filter((t) => t.parentId === null)
  return top.map((type) => ({ type, children: types.filter((t) => t.parentId === type.id) }))
}

/** What the doctor can still pick: active types, and active sub-types of active types. `keep` stays even if stopped (an old treatment). */
export function pickableTypes(types: TreatmentType[], keep: string[] = []): TypeNode[] {
  return typeTree(types)
    .filter((n) => n.type.isActive || keep.includes(n.type.id))
    .map((n) => ({ ...n, children: n.children.filter((c) => c.isActive || keep.includes(c.id)) }))
}

export const sessionsDone = (t: Pick<Treatment, 'sessions'>): number => t.sessions.filter((s) => s.status === 'COMPLETED').length

/** The close button shows only when every session is done AND nothing is owed. A doctor without the payments key cannot see money: the server then makes the final check. */
export function canClose(t: Pick<Treatment, 'sessions' | 'status' | 'remaining'>): boolean {
  return t.status === 'OPEN' && t.sessions.length > 0 && t.sessions.every((s) => s.status === 'COMPLETED') && (t.remaining === undefined || t.remaining === 0)
}

/** The first session that is not finished and has no live appointment yet. */
export function nextBookable(t: Pick<Treatment, 'sessions' | 'status'>): SessionRow | null {
  if (t.status !== 'OPEN') return null
  return t.sessions.find((s) => s.status === 'PLANNED' && (!s.appointment || s.appointment.status === 'CANCELLED')) ?? null
}

/** A treated tooth is amber while a treatment on it is open, green when all of them are finished. Cancelled treatments are ignored. */
export function toothMarks(treatments: Pick<Treatment, 'status' | 'toothCodes'>[]): Record<number, 'OPEN' | 'CLOSED'> {
  const marks: Record<number, 'OPEN' | 'CLOSED'> = {}
  for (const t of treatments) {
    if (t.status === 'CANCELLED') continue
    for (const c of t.toothCodes) if (t.status === 'OPEN') marks[c] = 'OPEN'
    else marks[c] ??= 'CLOSED'
  }
  return marks
}

/** Ready-made (dummy) list until the dentist gives the real one. */
export const DEFAULT_TYPES: { name: string; children: string[] }[] = [
  { name: 'حشوة', children: ['حشوة عادية', 'حشوة تجميلية', 'حشوة مؤقتة'] },
  { name: 'عصب', children: ['عصب أمامي', 'عصب ضاحك', 'عصب ضرس'] },
  { name: 'خلع', children: ['خلع بسيط', 'خلع جراحي', 'خلع ضرس عقل'] },
  { name: 'تلبيسة', children: ['زركون', 'بورسلان', 'معدن'] },
  { name: 'تنظيف وتلميع', children: [] },
]

// ---------------------------------------------------------------- API
export const listTreatmentTypes = () => request<TreatmentType[]>('/treatment-types')
export const createTreatmentType = (name: string, parentId?: string) => request<TreatmentType>('/treatment-types', { method: 'POST', body: { name, ...(parentId ? { parentId } : {}) } })
export const updateTreatmentType = (id: string, body: { name?: string; isActive?: boolean }) => request<TreatmentType>(`/treatment-types/${id}`, { method: 'PATCH', body })

export const listTreatments = (p: { patientId?: string; status?: TreatmentStatus } = {}) => {
  const qs = new URLSearchParams()
  if (p.patientId) qs.set('patientId', p.patientId)
  if (p.status) qs.set('status', p.status)
  return request<Treatment[]>(`/treatments${qs.size ? `?${qs}` : ''}`)
}
export const getTreatment = (id: string) => request<Treatment>(`/treatments/${id}`)
export const createTreatment = (body: Record<string, unknown>) => request<Treatment>('/treatments', { method: 'POST', body })
export const updateTreatment = (id: string, body: Record<string, unknown>) => request<Treatment>(`/treatments/${id}`, { method: 'PATCH', body })
export const completeSession = (id: string, number: number, notes?: string) => request<Treatment>(`/treatments/${id}/sessions/${number}/complete`, { method: 'POST', body: notes ? { notes } : {} })
export const bookSession = (id: string, number: number, body: { doctorId: string; startsAt: string; durationMinutes: 30 | 60; notes?: string }) =>
  request<Treatment>(`/treatments/${id}/sessions/${number}/appointment`, { method: 'POST', body })
export const closeTreatment = (id: string) => request<Treatment>(`/treatments/${id}/close`, { method: 'POST', body: {} })
export const cancelTreatment = (id: string, reason?: string) => request<Treatment>(`/treatments/${id}/cancel`, { method: 'POST', body: reason ? { reason } : {} })
export const addPayment = (id: string, body: { amount: number; method: PaymentMethod; paidAt: string; note?: string }) => request<Treatment>(`/treatments/${id}/payments`, { method: 'POST', body })
export const voidPayment = (paymentId: string, reason: string) => request<Treatment>(`/payments/${paymentId}/void`, { method: 'POST', body: { reason } })
export const getPatientFinance = (patientId: string) => request<PatientFinance>(`/patients/${patientId}/finance`)
