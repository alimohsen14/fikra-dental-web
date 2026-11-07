import { teethText } from './teeth.ts'
import { METHOD_LABELS, typeLabels } from './treatments.ts'
import type { PaymentMethod, Treatment } from './treatments.ts'

export interface StatementRow {
  id: string
  label: string
  teeth: string
  doctor: string
  startedAt: string
  status: Treatment['status']
  total: number
  paid: number
  remaining: number
}

export interface StatementPayment {
  id: string
  paidAt: string
  treatmentLabel: string
  amount: number
  method: PaymentMethod
  methodLabel: string
  voided: boolean
  voidReason: string | null
  note: string | null
}

export interface Statement {
  rows: StatementRow[]
  payments: StatementPayment[]
  total: number
  paid: number
  remaining: number
}

/**
 * The patient's account: one line per treatment (a treatment is one bill, however many teeth or sessions it has),
 * and every payment. Cancelled treatments and voided payments are never counted. Oldest first, like a ledger.
 * Returns null when the user may not see money (the treatments then carry no payments).
 */
export function buildStatement(treatments: Treatment[]): Statement | null {
  const live = treatments.filter((t) => t.status !== 'CANCELLED')
  if (live.some((t) => t.paid === undefined || t.payments === undefined)) return null
  const byOldest = [...live].sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id))
  const rows: StatementRow[] = byOldest.map((t) => ({
    id: t.id,
    label: typeLabels(t).join('، '),
    teeth: teethText(t.toothCodes),
    doctor: t.doctor.fullName,
    startedAt: t.startedAt,
    status: t.status,
    total: t.totalCost,
    paid: t.paid!,
    remaining: Math.max(0, t.totalCost - t.paid!),
  }))
  const payments: StatementPayment[] = byOldest
    .flatMap((t) => (t.payments ?? []).map((p) => ({ p, label: typeLabels(t).join('، ') })))
    .map(({ p, label }) => ({ id: p.id, paidAt: p.paidAt, treatmentLabel: label, amount: p.amount, method: p.method, methodLabel: METHOD_LABELS[p.method], voided: p.status === 'VOIDED', voidReason: p.voidReason, note: p.note }))
    .sort((a, b) => a.paidAt.localeCompare(b.paidAt) || a.id.localeCompare(b.id))
  const total = rows.reduce((s, r) => s + r.total, 0)
  const paid = rows.reduce((s, r) => s + r.paid, 0)
  return { rows, payments, total, paid, remaining: rows.reduce((s, r) => s + r.remaining, 0) }
}
