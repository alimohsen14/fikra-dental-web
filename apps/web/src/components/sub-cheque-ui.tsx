import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Badge, DateText, Loading, Money } from './admin-ui.tsx'
import { PhotoPicker } from './cheque-ui.tsx'
import { Modal } from './Modal.tsx'
import { Alert, Button, TextAreaField, TextField } from './ui.tsx'
import { cashSubCheque, fetchSubChequeImage, getSubCheque, returnSubCheque, SUB_CHEQUE_LABELS, SUB_CHEQUE_STYLE, uploadSubChequeImage } from '../lib/admin.ts'
import type { SubCheque, SubChequeInput } from '../lib/admin.ts'
import { ApiError } from '../lib/api.ts'
import { XRAY_MAX_BYTES, prepareXray } from '../lib/xrays.ts'
import { useLoad } from '../lib/useLoad.ts'

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'حدث خطأ غير متوقع، حاول مرة أخرى')

export interface SubChequeForm {
  dueDate: string
  chequeNumber: string
  bankName: string
  accountNumber: string
  drawerName: string
  drawerPhone: string
  notes: string
}
export const emptySubChequeForm = (): SubChequeForm => ({ dueDate: '', chequeNumber: '', bankName: '', accountNumber: '', drawerName: '', drawerPhone: '', notes: '' })

/** The amount is the payment's amount; only the day it can be cashed is required. Returns an Arabic problem or the cheque part of the request. */
export function buildSubCheque(f: SubChequeForm): { error: string } | { cheque: SubChequeInput } {
  if (!f.dueDate) return { error: 'اكتب تاريخ صرف الشك' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.dueDate)) return { error: 'تاريخ الصرف غير صحيح' }
  const text = (k: Exclude<keyof SubChequeForm, 'dueDate'>) => (f[k].trim() ? { [k]: f[k].trim() } : {})
  return { cheque: { dueDate: f.dueDate, ...text('chequeNumber'), ...text('bankName'), ...text('accountNumber'), ...text('drawerName'), ...text('drawerPhone'), ...text('notes') } }
}

/** The boxes of the cheque a clinic pays with. The amount is the payment's. */
export function SubChequeFields({ f, setF, photo, setPhoto, onError }: { f: SubChequeForm; setF: Dispatch<SetStateAction<SubChequeForm>>; photo: File | null; setPhoto: (f: File | null) => void; onError: (m: string | null) => void }) {
  const set = (k: keyof SubChequeForm) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-3 sm:col-span-2" data-testid="sub-cheque-fields">
      <p className="text-sm text-muted">مبلغ الشك هو مبلغ الدفعة. الإجباري تاريخ الصرف فقط، والباقي اختياري. الدفعة تنزّل المتبقي على العيادة فوراً، وتدخل الكاش يوم «تم الصرف».</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="تاريخ الصرف *" type="date" value={f.dueDate} onChange={set('dueDate')} />
        <TextField label="رقم الشك" dir="ltr" className="text-right" value={f.chequeNumber} maxLength={40} onChange={set('chequeNumber')} />
        <TextField label="اسم البنك" value={f.bankName} maxLength={80} onChange={set('bankName')} />
        <TextField label="رقم الحساب" dir="ltr" className="text-right" value={f.accountNumber} maxLength={40} onChange={set('accountNumber')} />
        <TextField label="صاحب الشك (الاسم)" value={f.drawerName} maxLength={120} onChange={set('drawerName')} />
        <TextField label="هاتف صاحب الشك" inputMode="tel" dir="ltr" className="text-right" value={f.drawerPhone} maxLength={30} onChange={set('drawerPhone')} />
      </div>
      <TextAreaField label="ملاحظات" value={f.notes} maxLength={500} onChange={set('notes')} />
      <PhotoPicker file={photo} onChange={setPhoto} onError={onError} />
    </div>
  )
}

/** Uploads the photo of a cheque that was just saved. Returns an Arabic problem, or null. */
export async function uploadSubChequePhoto(chequeId: string, photo: File): Promise<string | null> {
  try {
    const image = await prepareXray(photo)
    if (image.size > XRAY_MAX_BYTES) return 'الصورة كبيرة، الحد الأقصى 10 ميجابايت'
    await uploadSubChequeImage(chequeId, image)
    return null
  } catch (e) {
    return messageOf(e)
  }
}

export function SubChequeBadge({ c }: { c: Pick<SubCheque, 'status'> }) {
  return <Badge label={SUB_CHEQUE_LABELS[c.status]} {...SUB_CHEQUE_STYLE[c.status]} />
}

function Picture({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let made: string | null = null
    let cancelled = false
    fetchSubChequeImage(id)
      .then((b) => {
        if (cancelled) return
        made = URL.createObjectURL(b)
        setUrl(made)
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
      if (made) URL.revokeObjectURL(made)
    }
  }, [id])
  if (failed) return <span className="flex h-32 items-center justify-center rounded-xl bg-page text-sm text-muted">تعذّر فتح الصورة</span>
  if (!url) return <span className="block h-32 animate-pulse rounded-xl bg-page" />
  return <img src={url} alt="صورة الشك" className="max-h-80 w-full rounded-xl border border-line object-contain" />
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-[15px] font-semibold">{children}</span>
    </div>
  )
}

/** One cheque a clinic paid with: its details and photo, and "cashed" / "returned". */
export function SubChequeModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data: c, error, reload } = useLoad(() => getSubCheque(id), [id])
  const [mode, setMode] = useState<'view' | 'return'>('view')
  const [reason, setReason] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [picture, setPicture] = useState(0)

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setErr(null)
    try {
      await fn()
      setMode('view')
      reload()
      setPicture((n) => n + 1)
      onChanged()
    } catch (e) {
      setErr(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="شك دفعة اشتراك" onClose={onClose}>
      {!c ? (
        <Loading error={error} />
      ) : (
        <div className="flex flex-col gap-4" data-testid="sub-cheque-modal">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-2xl font-bold">
              <Money agorot={c.amount} />
            </span>
            <SubChequeBadge c={c} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Row label="العيادة">{c.clinic.name}</Row>
            <Row label="تاريخ الصرف">
              <DateText value={c.dueDate} />
            </Row>
            {c.chequeNumber && <Row label="رقم الشك">{c.chequeNumber}</Row>}
            {c.bankName && <Row label="البنك">{c.bankName}</Row>}
            {c.accountNumber && <Row label="رقم الحساب">{c.accountNumber}</Row>}
            {c.drawerName && <Row label="صاحب الشك">{c.drawerName}</Row>}
            {c.drawerPhone && <Row label="هاتف صاحب الشك">{c.drawerPhone}</Row>}
            {c.cashedAt && (
              <Row label="تاريخ الصرف الفعلي">
                <DateText value={c.cashedAt} />
              </Row>
            )}
            {c.returnReason && <Row label="سبب الإرجاع">{c.returnReason}</Row>}
            {c.notes && <Row label="ملاحظات">{c.notes}</Row>}
          </div>
          {c.hasImage ? <Picture key={picture} id={c.id} /> : <p className="text-sm text-muted">لا توجد صورة لهذا الشك.</p>}
          {err && <Alert tone="error">{err}</Alert>}
          {c.status === 'PENDING' && mode === 'view' && (
            <>
              <PhotoPicker file={photo} onChange={setPhoto} onError={setErr} />
              {photo && (
                <Button variant="secondary" busy={busy} onClick={() => void run(async () => {
                  const problem = await uploadSubChequePhoto(c.id, photo)
                  if (problem) throw new ApiError(400, problem)
                  setPhoto(null)
                })}>
                  حفظ الصورة
                </Button>
              )}
              <div className="flex flex-wrap gap-3">
                <Button busy={busy} data-testid="sub-cash" onClick={() => void run(() => cashSubCheque(c.id))}>
                  تم الصرف (دخل الكاش)
                </Button>
                <Button variant="danger" onClick={() => setMode('return')}>
                  مرتجع
                </Button>
              </div>
            </>
          )}
          {mode === 'return' && (
            <div className="flex flex-col gap-3 rounded-xl bg-[#fdf3f3] p-3">
              <p className="text-sm">الشك المرتجع لا يُحسب دخلاً، ويرجع المبلغ على العيادة كمتبقٍ.</p>
              <TextField label="سبب الإرجاع" value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="flex gap-3">
                <Button variant="danger" busy={busy} data-testid="sub-return" onClick={() => (reason.trim().length < 2 ? setErr('اكتب سبب الإرجاع') : void run(() => returnSubCheque(c.id, reason.trim())))}>
                  تأكيد الإرجاع
                </Button>
                <Button variant="secondary" onClick={() => setMode('view')}>
                  رجوع
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
