import { request } from './api.ts'
import { formatMoney, parseShekels } from './format.ts'

export type ChequeStatus = 'PENDING' | 'CASHED' | 'RETURNED' | 'ENDORSED' | 'CANCELLED'

export interface ChequeRow {
  id: string
  direction: 'INCOMING' | 'OUTGOING'
  status: ChequeStatus
  amount: number | null
  dueDate: string | null
  chequeNumber: string | null
  bankName: string | null
  accountNumber: string | null
  drawerName: string | null
  drawerPhone: string | null
  notes: string | null
  hasImage: boolean
  patientId: string | null
  treatmentId: string | null
  paymentId: string | null
  cashedAt: string | null
  returnedAt: string | null
  returnReason: string | null
  createdAt: string
  patient: { id: string; fullName: string } | null
  treatment: { id: string; description: string | null } | null
  /** Photographed without amount or due date: not counted as a payment yet. */
  incomplete: boolean
  /** For a cheque still in hand: has its day passed / is it today. */
  due: 'overdue' | 'today' | 'later' | null
}

interface Box {
  count: number
  amount: number
}
export interface ChequeTotals {
  pending: Box
  overdue: Box
  dueToday: Box
  cashed: Box
  returned: Box
  endorsed: Box
  incomplete: number
}
export interface ChequeSummary {
  incomplete: number
  dueToday: Box
  overdue: Box
  pending: Box
}
export interface ChequeList {
  items: ChequeRow[]
  totals: ChequeTotals
}

export const STATUS_LABELS: Record<ChequeStatus, string> = { PENDING: 'لم يُصرف بعد', CASHED: 'مصروف', RETURNED: 'مرتجع', ENDORSED: 'مُظهَّر', CANCELLED: 'ملغي' }
export const STATUS_STYLE: Record<ChequeStatus, string> = {
  PENDING: 'bg-[#fff4d6] text-[#7a5200]',
  CASHED: 'bg-[#e2f5e9] text-[#14693a]',
  RETURNED: 'bg-[#fde8e8] text-[#9b1c1c]',
  ENDORSED: 'bg-[#e8eefc] text-[#2a4a9b]',
  CANCELLED: 'bg-page text-muted',
}

export type ChequeFilter = 'ALL' | 'PENDING' | 'CASHED' | 'RETURNED' | 'INCOMPLETE'
export const FILTER_LABELS: Record<ChequeFilter, string> = { ALL: 'الكل', PENDING: 'لم تُصرف', CASHED: 'مصروفة', RETURNED: 'مرتجعة', INCOMPLETE: 'ناقصة' }
export const filterQuery = (f: ChequeFilter): string => (f === 'ALL' ? '' : f === 'INCOMPLETE' ? 'incomplete=true' : `status=${f}`)

export const listCheques = (query = '') => request<ChequeList>(`/cheques${query ? `?${query}` : ''}`)
export const listTreatmentCheques = (treatmentId: string) => request<ChequeList>(`/cheques?treatmentId=${treatmentId}`)
export const getChequeSummary = () => request<ChequeSummary>('/cheques/summary')
export const getCheque = (id: string) => request<ChequeRow>(`/cheques/${id}`)
export const createCheque = (treatmentId: string, body: ChequeBody) => request<ChequeRow>(`/treatments/${treatmentId}/cheques`, { method: 'POST', body })
export const updateCheque = (id: string, body: ChequeBody) => request<ChequeRow>(`/cheques/${id}`, { method: 'PATCH', body })
export const cashCheque = (id: string) => request<ChequeRow>(`/cheques/${id}/cash`, { method: 'POST', body: {} })
export const returnCheque = (id: string, reason: string) => request<ChequeRow>(`/cheques/${id}/return`, { method: 'POST', body: reason.trim() ? { reason: reason.trim() } : {} })
export const cancelCheque = (id: string) => request<ChequeRow>(`/cheques/${id}/cancel`, { method: 'POST', body: {} })
export const uploadChequeImage = (id: string, image: Blob) => request<ChequeRow>(`/cheques/${id}/image`, { method: 'POST', file: image })
/** The photo needs the login, so it is fetched with the token and shown from memory (an <img src> could not send it). */
export const fetchChequeImage = (id: string) => request<Blob>(`/cheques/${id}/image`, { blob: true })

export interface ChequeBody {
  amount?: number
  dueDate?: string
  chequeNumber?: string
  bankName?: string
  accountNumber?: string
  drawerName?: string
  drawerPhone?: string
  notes?: string
}

export interface ChequeForm {
  amount: string
  dueDate: string
  chequeNumber: string
  bankName: string
  accountNumber: string
  drawerName: string
  drawerPhone: string
  notes: string
}
export const emptyChequeForm = (): ChequeForm => ({ amount: '', dueDate: '', chequeNumber: '', bankName: '', accountNumber: '', drawerName: '', drawerPhone: '', notes: '' })
export const formOfCheque = (c: ChequeRow): ChequeForm => ({
  amount: c.amount === null ? '' : String(c.amount / 100),
  dueDate: c.dueDate ?? '',
  chequeNumber: c.chequeNumber ?? '',
  bankName: c.bankName ?? '',
  accountNumber: c.accountNumber ?? '',
  drawerName: c.drawerName ?? '',
  drawerPhone: c.drawerPhone ?? '',
  notes: c.notes ?? '',
})

/** Amount and day are the only required things, and even they may wait (a cheque can be photographed first). `remaining` = what the treatment still owes. */
function check(f: ChequeForm, remaining: number): { error: string } | { amount?: number; dueDate?: string } {
  const out: { amount?: number; dueDate?: string } = {}
  if (f.amount.trim() !== '') {
    const amount = parseShekels(f.amount)
    if (amount === null || amount < 1) return { error: 'اكتب مبلغ الشك كرقم، مثال: 500' }
    if (amount > remaining) return { error: `المبلغ أكبر من المتبقي (${formatMoney(remaining)})` }
    out.amount = amount
  }
  if (f.dueDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.dueDate)) return { error: 'تاريخ الصرف غير صحيح' }
    out.dueDate = f.dueDate
  }
  return out
}

/** A new cheque: only the boxes that were filled are sent. */
export function buildChequeCreate(f: ChequeForm, remaining: number): { error: string } | { body: ChequeBody } {
  const c = check(f, remaining)
  if ('error' in c) return c
  const text = (k: 'chequeNumber' | 'bankName' | 'accountNumber' | 'drawerName' | 'drawerPhone' | 'notes') => (f[k].trim() ? { [k]: f[k].trim() } : {})
  return { body: { ...c, ...text('chequeNumber'), ...text('bankName'), ...text('accountNumber'), ...text('drawerName'), ...text('drawerPhone'), ...text('notes') } }
}

/** Editing: an empty text box clears that detail; the amount and the day can be changed but not removed. */
export function buildChequeUpdate(f: ChequeForm, remaining: number): { error: string } | { body: ChequeBody } {
  const c = check(f, remaining)
  if ('error' in c) return c
  return { body: { ...c, chequeNumber: f.chequeNumber.trim(), bankName: f.bankName.trim(), accountNumber: f.accountNumber.trim(), drawerName: f.drawerName.trim(), drawerPhone: f.drawerPhone.trim(), notes: f.notes.trim() } }
}

/** "Missing" reminder wording: what is still needed on an incomplete cheque. */
export function missingOf(c: Pick<ChequeRow, 'amount' | 'dueDate'>): string {
  const m = [c.amount === null ? 'المبلغ' : null, c.dueDate === null ? 'تاريخ الصرف' : null].filter(Boolean)
  return m.length ? `ينقصه: ${m.join(' و')}` : ''
}
