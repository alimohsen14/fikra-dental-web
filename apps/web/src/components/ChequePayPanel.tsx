import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Money } from './admin-ui.tsx'
import { ChequeFields, PhotoPicker } from './cheque-ui.tsx'
import { Alert } from './ui.tsx'
import { ApiError } from '../lib/api.ts'
import { buildChequeCreate, emptyChequeForm, handOverCheques, issueChequeForExpense, listCheques, listOutgoingDueOn, uploadChequeImage } from '../lib/cheques.ts'
import type { ChequeForm, ChequeRow } from '../lib/cheques.ts'
import { XRAY_MAX_BYTES, prepareXray } from '../lib/xrays.ts'
import { useLoad } from '../lib/useLoad.ts'
import { DateText } from './admin-ui.tsx'

export interface ChequePay {
  /** `new`: a cheque we write now. `existing`: cheques patients gave us, handed over. */
  mode: 'new' | 'existing'
  form: ChequeForm
  photo: File | null
  selected: string[]
}
export const emptyChequePay = (): ChequePay => ({ mode: 'new', form: emptyChequeForm(), photo: null, selected: [] })

/** Warns (never blocks) when another cheque we wrote falls due on the same day. */
function SameDayWarning({ day }: { day: string }) {
  const { data } = useLoad(() => (day ? listOutgoingDueOn(day) : Promise.resolve(null)), [day])
  const same = data?.items ?? []
  if (!day || same.length === 0) return null
  const total = same.reduce((t, c) => t + (c.amount ?? 0), 0)
  return (
    <Alert tone="warning">
      <span data-testid="same-day-warning">
        تنبيه: عندك {same.length} شك صادر بنفس تاريخ الصرف (<DateText value={day} />) مجموعها <Money agorot={total} />. تأكد أن الرصيد يكفي ذلك اليوم.
      </span>
    </Alert>
  )
}

/**
 * Paying a bill with a cheque: write a new one, or hand over cheques patients gave us that are still in hand
 * (one or several, together not more than what is left of the bill).
 */
export function ChequePayPanel({ value, onChange, remaining, onError }: { value: ChequePay; onChange: Dispatch<SetStateAction<ChequePay>>; remaining: number; onError: (m: string | null) => void }) {
  const inHand = useLoad(() => listCheques('direction=INCOMING&status=PENDING'), [])
  const usable = (inHand.data?.items ?? []).filter((c) => !c.incomplete && c.amount !== null)
  const picked = usable.filter((c) => value.selected.includes(c.id))
  const total = picked.reduce((t, c) => t + (c.amount ?? 0), 0)
  // forget a selection that is no longer available
  useEffect(() => {
    if (inHand.data) onChange((v) => ({ ...v, selected: v.selected.filter((id) => usable.some((c) => c.id === id)) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inHand.data])
  const toggle = (c: ChequeRow) => onChange((v) => ({ ...v, selected: v.selected.includes(c.id) ? v.selected.filter((x) => x !== c.id) : [...v.selected, c.id] }))
  const setForm: Dispatch<SetStateAction<ChequeForm>> = (u) => onChange((v) => ({ ...v, form: typeof u === 'function' ? u(v.form) : u }))

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line p-3" data-testid="cheque-pay-panel">
      <div role="tablist" aria-label="نوع الشك" className="flex flex-wrap gap-2">
        {(
          [
            ['new', 'أكتب شكاً جديداً'],
            ['existing', 'من الشكات الواردة (التي لم تُصرف)'],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={value.mode === m}
            onClick={() => {
              onChange((v) => ({ ...v, mode: m }))
              onError(null)
            }}
            className={`h-10 cursor-pointer rounded-full border px-4 text-sm font-semibold ${value.mode === m ? 'border-brand bg-brand text-on-brand' : 'border-line bg-white'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {value.mode === 'new' ? (
        <>
          <ChequeFields f={value.form} setF={setForm} required />
          <SameDayWarning day={value.form.dueDate} />
          <PhotoPicker file={value.photo} onChange={(photo) => onChange((v) => ({ ...v, photo }))} onError={onError} />
        </>
      ) : (
        <>
          <p className="text-sm text-muted">اختر شكاً أو أكثر لتسديد المصروف. يُنقل الشك من «لم يُصرف» إلى «محوّل لصادر»، ويُحسب دخلاً ومصروفاً في اليوم نفسه. المتبقي على المصروف: <Money agorot={remaining} />.</p>
          {!inHand.data ? (
            <p className="text-sm text-muted">جاري التحميل...</p>
          ) : usable.length === 0 ? (
            <p className="text-sm text-muted">لا توجد شكات واردة مكتملة وبانتظار الصرف.</p>
          ) : (
            <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto" aria-label="الشكات الواردة">
              {usable.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3">
                    <span className="flex items-center gap-3">
                      <input type="checkbox" checked={value.selected.includes(c.id)} onChange={() => toggle(c)} className="size-5" aria-label={`شك ${c.patient?.fullName ?? ''}`} />
                      <span className="flex flex-col">
                        <span className="font-semibold">{c.patient?.fullName ?? 'مريض'}</span>
                        <span className="text-xs text-muted">
                          يُصرف {c.dueDate ? <DateText value={c.dueDate} /> : '-'}
                          {c.chequeNumber ? ` · رقم ${c.chequeNumber}` : ''}
                          {c.bankName ? ` · ${c.bankName}` : ''}
                        </span>
                      </span>
                    </span>
                    <strong>
                      <Money agorot={c.amount ?? 0} />
                    </strong>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm font-semibold" data-testid="picked-total">
            المختار: {picked.length} شك · <Money agorot={total} />
          </p>
          {total > remaining && <Alert tone="error">مجموع الشكات أكبر من المتبقي على المصروف.</Alert>}
        </>
      )}
    </div>
  )
}

/** What a cheque payment would add to the bill (for showing "to pay"). null while nothing is chosen. */
export function chequePayAmount(v: ChequePay, usable: ChequeRow[]): number | null {
  if (v.mode === 'existing') return usable.filter((c) => v.selected.includes(c.id)).reduce((t, c) => t + (c.amount ?? 0), 0) || null
  const r = buildChequeCreate(v.form, Number.MAX_SAFE_INTEGER)
  return 'body' in r && r.body.amount ? r.body.amount : null
}

/** Checks what was typed/chosen, then does it on the bill. Returns an Arabic error, or null when done. `paidAtIso` = the day it counts as paid. */
export async function payBillWithCheque(expenseId: string, v: ChequePay, remaining: number, paidAtIso: string): Promise<string | null> {
  try {
    if (v.mode === 'existing') {
      if (v.selected.length === 0) return 'اختر شكاً واحداً على الأقل'
      await handOverCheques(expenseId, v.selected, paidAtIso)
      return null
    }
    // an empty amount means "the whole bill"
    const form = v.form.amount.trim() === '' && remaining < Number.MAX_SAFE_INTEGER ? { ...v.form, amount: String(remaining / 100) } : v.form
    const r = buildChequeCreate(form, remaining)
    if ('error' in r) return r.error
    if (!r.body.amount) return 'اكتب مبلغ الشك'
    if (!r.body.dueDate) return 'اكتب تاريخ صرف الشك'
    const made = await issueChequeForExpense(expenseId, { ...r.body, paidAt: paidAtIso })
    if (v.photo) {
      try {
        const image = await prepareXray(v.photo)
        if (image.size > XRAY_MAX_BYTES) throw new ApiError(413, 'الصورة كبيرة، الحد الأقصى 10 ميجابايت')
        await uploadChequeImage(made.id, image)
      } catch (e) {
        return `حُفظ الشك لكن تعذّر رفع الصورة: ${e instanceof ApiError ? e.message : 'خطأ غير متوقع'}. افتح الشك من صفحة الشكات لإضافتها.`
      }
    }
    return null
  } catch (e) {
    return e instanceof ApiError ? e.message : 'حدث خطأ غير متوقع، حاول مرة أخرى'
  }
}
