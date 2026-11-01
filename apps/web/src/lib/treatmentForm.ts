// Turns what the doctor typed on the treatment page into what the API wants (or an Arabic problem message).
import { formatMoney, paidAtIso, parseShekels } from './format.ts'
import { toothLabel, toothOrder } from './teeth.ts'
import type { PaymentMethod, Treatment, TreatmentType } from './treatments.ts'

/** One chosen tooth with its own type (and sub-type when the type has some). */
export interface ToothEntry {
  code: number
  typeId: string
  subTypeId: string
}

export interface TreatmentFormValues {
  patientId: string
  doctorId: string
  teeth: ToothEntry[]
  description: string
  cost: string
  sessions: string
  day: string // "paid/started on" day, only for treatments without an appointment
  appointmentId: string
}

export const EMPTY_TREATMENT: TreatmentFormValues = { patientId: '', doctorId: '', teeth: [], description: '', cost: '', sessions: '1', day: '', appointmentId: '' }

/** The type to save: the sub-type when the chosen type has active sub-types, else the type itself. */
export function resolveTypeId(types: TreatmentType[], typeId: string, subTypeId: string): { id: string } | { error: string } {
  if (!typeId) return { error: 'اختر نوع العلاج' }
  const subs = types.filter((t) => t.parentId === typeId && t.isActive)
  if (subs.length === 0) return { id: typeId }
  if (!subTypeId) return { error: 'اختر النوع الفرعي' }
  if (types.some((t) => t.id === subTypeId && t.parentId === typeId && !t.isActive)) return { error: 'هذا النوع الفرعي موقوف، اختر غيره' }
  if (!subs.some((t) => t.id === subTypeId)) return { error: 'النوع الفرعي مش تابع لهذا النوع' }
  return { id: subTypeId }
}

const byOrder = (a: ToothEntry, b: ToothEntry) => toothOrder(a.code) - toothOrder(b.code)

/** Picks or un-picks a tooth. A new tooth starts with the type of the last tooth that has one, so the doctor changes only the odd ones. */
export function toggleEntry(teeth: ToothEntry[], code: number): ToothEntry[] {
  if (teeth.some((t) => t.code === code)) return teeth.filter((t) => t.code !== code)
  const last = [...teeth].reverse().find((t) => t.typeId)
  return [...teeth, { code, typeId: last?.typeId ?? '', subTypeId: last?.subTypeId ?? '' }].sort(byOrder)
}

export const setEntryType = (teeth: ToothEntry[], code: number, typeId: string): ToothEntry[] => teeth.map((t) => (t.code === code ? { ...t, typeId, subTypeId: '' } : t))
export const setEntrySub = (teeth: ToothEntry[], code: number, subTypeId: string): ToothEntry[] => teeth.map((t) => (t.code === code ? { ...t, subTypeId } : t))

/** Gives every tooth the type of one tooth. */
export function copyTypeToAll(teeth: ToothEntry[], code: number): ToothEntry[] {
  const from = teeth.find((t) => t.code === code)
  return from ? teeth.map((t) => ({ ...t, typeId: from.typeId, subTypeId: from.subTypeId })) : teeth
}

/** The form rows of an existing treatment. */
export function entriesOf(t: Pick<Treatment, 'teeth'>): ToothEntry[] {
  return t.teeth
    .map((x) => ({ code: x.toothCode, typeId: x.treatmentType.parent?.id ?? x.treatmentType.id, subTypeId: x.treatmentType.parent ? x.treatmentType.id : '' }))
    .sort(byOrder)
}

/** Type ids (and their parents) an old treatment already uses, so they stay pickable even if stopped. */
export const typeIdsOf = (t: Pick<Treatment, 'teeth'>): string[] => t.teeth.flatMap((x) => [x.treatmentType.id, ...(x.treatmentType.parent ? [x.treatmentType.parent.id] : [])])

type Common = { error: string } | { teeth: { toothCode: number; treatmentTypeId: string }[]; totalCost: number; plannedSessions: number }

function common(v: TreatmentFormValues, types: TreatmentType[]): Common {
  if (v.teeth.length === 0) return { error: 'اختر سن واحد على الأقل من المخطط' }
  const teeth: { toothCode: number; treatmentTypeId: string }[] = []
  for (const t of [...v.teeth].sort(byOrder)) {
    const type = resolveTypeId(types, t.typeId, t.subTypeId)
    if ('error' in type) return { error: `السن ${toothLabel(t.code)}: ${type.error}` }
    teeth.push({ toothCode: t.code, treatmentTypeId: type.id })
  }
  const totalCost = parseShekels(v.cost)
  if (totalCost === null) return { error: 'اكتب التكلفة الكلية كرقم، مثال: 800 (اكتب 0 إذا العلاج مجاني)' }
  const n = Number(v.sessions)
  if (!/^\d{1,2}$/.test(v.sessions.trim()) || n < 1 || n > 50) return { error: 'عدد الجلسات رقم من 1 إلى 50' }
  return { teeth, totalCost, plannedSessions: n }
}

export function buildCreateTreatment(v: TreatmentFormValues, types: TreatmentType[]): { error: string } | { body: Record<string, unknown> } {
  if (!v.patientId) return { error: 'اختر المريض' }
  if (!v.doctorId) return { error: 'اختر الدكتور' }
  const c = common(v, types)
  if ('error' in c) return c
  return {
    body: {
      patientId: v.patientId,
      doctorId: v.doctorId,
      ...c,
      ...(v.description.trim() ? { description: v.description.trim() } : {}),
      ...(v.appointmentId ? { appointmentId: v.appointmentId } : v.day ? { startedAt: paidAtIso(v.day) } : {}),
    },
  }
}

export function buildEditTreatment(v: TreatmentFormValues, types: TreatmentType[]): { error: string } | { body: Record<string, unknown> } {
  const c = common(v, types)
  if ('error' in c) return c
  return { body: { ...c, description: v.description.trim() } } // empty -> the API clears it
}

/** A new payment: amount (shekels), method, day. Never above what is left. */
export function buildTreatmentPayment(
  f: { amount: string; method: PaymentMethod; day: string; note: string },
  remaining: number,
): { error: string } | { body: { amount: number; method: PaymentMethod; paidAt: string; note?: string } } {
  const amount = parseShekels(f.amount)
  if (amount === null || amount < 1) return { error: 'اكتب مبلغ الدفعة كرقم، مثال: 300' }
  if (amount > remaining) return { error: `المبلغ أكبر من المتبقي (${formatMoney(remaining)})` }
  if (!f.day) return { error: 'اختر تاريخ الدفعة' }
  return { body: { amount, method: f.method, paidAt: paidAtIso(f.day), ...(f.note.trim() ? { note: f.note.trim() } : {}) } }
}
