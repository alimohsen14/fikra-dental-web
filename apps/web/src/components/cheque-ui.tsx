import { useEffect, useRef, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/AuthContext.tsx'
import { DateText, Loading, Money } from './admin-ui.tsx'
import { Modal } from './Modal.tsx'
import { Alert, Button, TextAreaField, TextField } from './ui.tsx'
import { ApiError } from '../lib/api.ts'
import { buildChequeUpdate, cancelCheque, cashCheque, fetchChequeImage, formOfCheque, getCheque, handOverCheques, missingOf, returnCheque, statusLabelOf, STATUS_STYLE, updateCheque, uploadChequeImage } from '../lib/cheques.ts'
import type { ChequeForm, ChequeRow } from '../lib/cheques.ts'
import { XRAY_MAX_BYTES, prepareXray, xrayFileError } from '../lib/xrays.ts'
import { useLoad } from '../lib/useLoad.ts'
import { listExpenses } from '../lib/expenses.ts'
import { FUTURE_DAY_ERROR, isFutureDay, paidAtIso, todayInput } from '../lib/format.ts'

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'حدث خطأ غير متوقع، حاول مرة أخرى')

export function StatusBadge({ c }: { c: Pick<ChequeRow, 'status' | 'incomplete' | 'direction'> }) {
  if (c.incomplete) return <span className="rounded-full bg-[#fde8e8] px-3 py-1 text-xs font-bold text-[#9b1c1c]">ناقص</span>
  // the ones we wrote ourselves are blue while they wait, so they are never mistaken for a patient's
  const style = c.direction === 'OUTGOING' && c.status === 'PENDING' ? 'bg-[#e8eefc] text-[#2a4a9b]' : STATUS_STYLE[c.status]
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${style}`}>{statusLabelOf(c)}</span>
}

/** One line telling whether the day of a cheque still in hand has come. */
export function DueNote({ c }: { c: Pick<ChequeRow, 'due'> }) {
  if (c.due === 'overdue') return <span className="text-sm font-bold text-[#9b1c1c]">فات موعد صرفه ولم يُصرف</span>
  if (c.due === 'today') return <span className="text-sm font-bold text-[#7a5200]">موعد صرفه اليوم</span>
  return null
}

/** A cheque photo, loaded with the login and shown from memory. */
export function ChequePicture({ id, className }: { id: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let made: string | null = null
    let cancelled = false
    fetchChequeImage(id)
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
  if (failed) return <span className={`flex items-center justify-center bg-page text-sm text-muted ${className ?? ''}`}>تعذّر فتح الصورة</span>
  if (!url) return <span className={`block animate-pulse bg-page ${className ?? ''}`} />
  return <img src={url} alt="صورة الشك" className={className} />
}

/** Picks (or takes, on a phone) a photo of the cheque. The file is only chosen here; the caller uploads it after the cheque is saved. */
export function PhotoPicker({ file, onChange, onError }: { file: File | null; onChange: (f: File | null) => void; onError: (m: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line p-3">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        aria-label="صورة الشك"
        data-testid="cheque-photo"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (!f) return
          const bad = xrayFileError(f)
          onError(bad)
          if (!bad) onChange(f)
          e.target.value = ''
        }}
      />
      <Button variant="secondary" onClick={() => input.current?.click()}>
        {file ? 'تغيير الصورة' : 'تصوير الشك / اختيار صورة'}
      </Button>
      {file ? (
        <span className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{file.name}</span>
          <button type="button" className="cursor-pointer text-[#9b1c1c] underline" onClick={() => onChange(null)}>
            إزالة
          </button>
        </span>
      ) : (
        <span className="text-sm text-muted">اختيارية. تُحفظ للأرشفة، والبيانات تكتبها أنت.</span>
      )}
    </div>
  )
}

/** The boxes of a cheque. Everything is optional here: a cheque can be photographed first and completed later. */
export function ChequeFields({ f, setF, required = false, lockAmount = false }: { f: ChequeForm; setF: Dispatch<SetStateAction<ChequeForm>>; required?: boolean; lockAmount?: boolean }) {
  const set = (k: keyof ChequeForm) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="مبلغ الشك (₪) *" inputMode="decimal" dir="ltr" className="text-right" value={f.amount} readOnly={lockAmount} hint={lockAmount ? 'لا يمكن تغيير مبلغ شك صادر: ألغِه واكتب شكاً جديداً.' : undefined} onChange={set('amount')} />
        <TextField label="تاريخ الصرف *" type="date" value={f.dueDate} onChange={set('dueDate')} />
      </div>
      <p className="-mt-2 text-sm text-muted">
        {required ? 'المبلغ وتاريخ الصرف مطلوبان. تاريخ الصرف للمعرفة فقط: يُحسب المصروف يوم كتابة الشك.' : 'المبلغ وتاريخ الصرف مطلوبان. إن تركتهما فارغين يُحفظ الشك «ناقصاً» ويبقى تنبيه في الصفحة الرئيسية حتى تكملهما، ولا يُحسب من الدفعات قبل ذلك.'}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="رقم الشك" dir="ltr" className="text-right" value={f.chequeNumber} maxLength={40} onChange={set('chequeNumber')} />
        <TextField label="اسم البنك" value={f.bankName} maxLength={80} onChange={set('bankName')} />
        <TextField label="رقم الحساب" dir="ltr" className="text-right" value={f.accountNumber} maxLength={40} onChange={set('accountNumber')} />
        <TextField label="صاحب الشك (الاسم)" value={f.drawerName} maxLength={120} onChange={set('drawerName')} />
        <TextField label="هاتف صاحب الشك" inputMode="tel" dir="ltr" className="text-right" value={f.drawerPhone} maxLength={30} onChange={set('drawerPhone')} />
      </div>
      <TextAreaField label="ملاحظات" value={f.notes} maxLength={500} onChange={set('notes')} />
    </>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-[15px] font-semibold">{children}</span>
    </div>
  )
}

/** One cheque: all its details and photo, and what can still be done with it. */
/** Pays one unpaid bill with an incoming cheque that is still in hand ("convert to outgoing"). Owner only. */
function HandOverPanel({ c, onDone, onCancel }: { c: ChequeRow; onDone: () => void; onCancel: () => void }) {
  const bills = useLoad(() => listExpenses({ unpaid: true }), [])
  const [pick, setPick] = useState<string | null>(null)
  const [day, setDay] = useState(todayInput())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const usable = (bills.data ?? []).filter((e) => e.status === 'ACTIVE' && e.remaining >= (c.amount ?? 0))
  async function go() {
    if (!pick) return setErr('اختر المصروف الذي تريد دفعه بهذا الشك')
    if (!day) return setErr('اختر التاريخ')
    if (isFutureDay(day)) return setErr(FUTURE_DAY_ERROR)
    setBusy(true)
    setErr(null)
    try {
      await handOverCheques(pick, [c.id], paidAtIso(day))
      onDone()
    } catch (e) {
      setErr(messageOf(e))
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line p-3" data-testid="handover-panel">
      <p className="text-sm">اختر المصروف الذي ستدفعه بهذا الشك. يُحسب دخلاً ومصروفاً في نفس اليوم (الربح لا يتغيّر)، ولا يتأثر رصيد المريض.</p>
      {bills.loading ? (
        <p className="text-sm text-muted">جاري التحميل...</p>
      ) : usable.length === 0 ? (
        <p className="text-sm text-muted">لا يوجد مصروف غير مدفوع يتّسع لمبلغ هذا الشك.</p>
      ) : (
        <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto" aria-label="المصاريف غير المدفوعة">
          {usable.map((e) => (
            <li key={e.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-line p-2">
                <input type="radio" name="handover-bill" checked={pick === e.id} onChange={() => setPick(e.id)} className="size-5" aria-label={`مصروف ${e.supplier?.name ?? e.category.name}`} />
                <span className="flex-1 text-sm">
                  <strong>{e.supplier?.name ?? e.category.name}</strong>
                  {e.description ? ` · ${e.description}` : ''}
                </span>
                <span className="text-sm">
                  علينا <Money agorot={e.remaining} />
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <TextField label="تاريخ التحويل" type="date" max={todayInput()} value={day} onChange={(e) => setDay(e.target.value)} />
      {err && <Alert tone="error">{err}</Alert>}
      <div className="flex gap-3">
        <Button busy={busy} onClick={() => void go()}>
          تحويل لصادر
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          رجوع
        </Button>
      </div>
    </div>
  )
}

export function ChequeModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data: c, error, reload } = useLoad(() => getCheque(id), [id])
  const [mode, setMode] = useState<'view' | 'edit' | 'return' | 'handover'>('view')
  const { session } = useAuth()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [form, setForm] = useState<ChequeForm | null>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [reason, setReason] = useState('')
  const [shot, setShot] = useState(0) // changes after a new photo so it is fetched again

  const changed = () => {
    reload()
    onChanged()
  }
  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setErr(null)
    try {
      await fn()
      setMode('view')
      changed()
    } catch (e) {
      setErr(messageOf(e))
    } finally {
      setBusy(false)
    }
  }
  async function upload(file: File) {
    const image = await prepareXray(file)
    if (image.size > XRAY_MAX_BYTES) throw new ApiError(413, 'الصورة كبيرة، الحد الأقصى 10 ميجابايت')
    await uploadChequeImage(id, image)
    setShot((n) => n + 1)
  }

  if (!c) {
    return (
      <Modal title="الشك" onClose={onClose}>
        <Loading error={error} />
      </Modal>
    )
  }
  const pending = c.status === 'PENDING'
  const outgoing = c.direction === 'OUTGOING'
  const missing = missingOf(c)

  if (mode === 'edit' && form) {
    return (
      <Modal title={c.incomplete ? 'إكمال بيانات الشك' : 'تعديل الشك'} onClose={onClose}>
        <ChequeFields f={form} setF={setForm as Dispatch<SetStateAction<ChequeForm>>} required={outgoing} lockAmount={outgoing} />
        <PhotoPicker file={photo} onChange={setPhoto} onError={setErr} />
        {err && <Alert tone="error">{err}</Alert>}
        <div className="flex flex-wrap gap-3">
          <Button
            busy={busy}
            onClick={() =>
              void run(async () => {
                const r = buildChequeUpdate(form, Number.MAX_SAFE_INTEGER)
                if ('error' in r) throw new ApiError(400, r.error)
                await updateCheque(id, r.body)
                if (photo) await upload(photo)
                setPhoto(null)
              })
            }
          >
            حفظ
          </Button>
          <Button variant="secondary" onClick={() => setMode('view')}>
            رجوع
          </Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={outgoing ? 'شك صادر' : 'الشك'} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge c={c} />
        <DueNote c={c} />
        {c.incomplete && <span className="text-sm font-bold text-[#9b1c1c]">{missing}</span>}
      </div>
      <div className="grid grid-cols-2 gap-4" data-testid="cheque-details">
        <Row label="المبلغ">{c.amount === null ? '—' : <Money agorot={c.amount} />}</Row>
        <Row label="تاريخ الصرف">{c.dueDate ? <DateText value={c.dueDate} /> : '—'}</Row>
        {outgoing ? (
          <>
            <Row label="المصروف">{c.bill ? c.bill.category + (c.bill.description ? ` · ${c.bill.description}` : '') : '—'}</Row>
            <Row label="الجهة (المورّد)">{c.bill?.supplier?.name ?? '—'}</Row>
          </>
        ) : (
          <>
            <Row label="المريض">
              {c.patient ? (
                <Link to={`/patients/${c.patient.id}`} className="underline">
                  {c.patient.fullName}
                </Link>
              ) : (
                '—'
              )}
            </Row>
            <Row label="العلاج">
              {c.treatment ? (
                <Link to={`/treatments/${c.treatment.id}`} className="underline">
                  {c.treatment.description || 'فتح العلاج'}
                </Link>
              ) : (
                '—'
              )}
            </Row>
          </>
        )}
        {mode === 'handover' && (
        <HandOverPanel
          c={c}
          onCancel={() => setMode('view')}
          onDone={() => {
            setMode('view')
            changed()
          }}
        />
      )}
      {c.status === 'ENDORSED' && (
          <Row label="حُوِّل لدفع مصروف">
            {c.bill ? `${c.bill.category}${c.bill.supplier ? ` · ${c.bill.supplier.name}` : ''}` : 'مصروف'}
            {c.endorsedAt && (
              <>
                {' · '}
                <DateText value={c.endorsedAt} />
              </>
            )}
          </Row>
        )}
        <Row label="رقم الشك">{c.chequeNumber ?? '—'}</Row>
        <Row label="البنك">{c.bankName ?? '—'}</Row>
        <Row label="رقم الحساب">{c.accountNumber ?? '—'}</Row>
        <Row label="صاحب الشك">{c.drawerName ?? '—'}</Row>
        <Row label="هاتف صاحب الشك">{c.drawerPhone ?? '—'}</Row>
        {c.cashedAt && <Row label="تاريخ الصرف الفعلي"><DateText value={c.cashedAt} /></Row>}
        {c.status === 'RETURNED' && <Row label="سبب الإرجاع">{c.returnReason ?? '—'}</Row>}
      </div>
      {c.notes && <p className="rounded-xl bg-page p-3 text-[15px]">{c.notes}</p>}
      {c.hasImage ? <ChequePicture key={shot} id={c.id} className="max-h-[60vh] w-full rounded-xl bg-black object-contain" /> : <p className="text-sm text-muted">لا توجد صورة لهذا الشك.</p>}
      {pending && !c.hasImage && <PhotoPicker file={photo} onChange={(f) => setPhoto(f)} onError={setErr} />}
      {pending && !c.hasImage && photo && (
        <Button className="self-start" busy={busy} onClick={() => void run(async () => { await upload(photo); setPhoto(null) })}>
          رفع الصورة
        </Button>
      )}
      {mode === 'return' && (
        <div className="flex flex-col gap-3 rounded-xl border border-line p-3">
          <p className="text-sm">عند إرجاع الشك يُلغى من الدفعات ويعود المبلغ مطلوباً من المريض، ويبقى الشك ظاهراً كمرتجع.</p>
          <TextAreaField label="سبب الإرجاع (اختياري)" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-3">
            <Button variant="danger" busy={busy} onClick={() => void run(() => returnCheque(id, reason))}>
              تأكيد الإرجاع
            </Button>
            <Button variant="secondary" onClick={() => setMode('view')}>
              رجوع
            </Button>
          </div>
        </div>
      )}
      {c.status === 'ENDORSED' && <p className="text-sm text-muted">لإرجاع هذا الشك لما بالإيد، ألغِ دفعة المصروف الذي حُوِّل له من صفحة المصاريف.</p>}
      {err && <Alert tone="error">{err}</Alert>}
      {pending && mode === 'view' && (
        <div className="flex flex-wrap gap-3">
          {!c.incomplete && (
            <Button busy={busy} onClick={() => void run(() => cashCheque(id))}>
              تم صرف الشك
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              setForm(formOfCheque(c))
              setPhoto(null)
              setErr(null)
              setMode('edit')
            }}
          >
            {c.incomplete ? 'إكمال البيانات' : 'تعديل'}
          </Button>
          {!c.incomplete && !outgoing && session?.user.role === 'OWNER' && (
            <Button variant="secondary" data-testid="handover-btn" onClick={() => setMode('handover')}>
              تحويل لصادر
            </Button>
          )}
          {!c.paymentId ? (
            <Button variant="danger" busy={busy} onClick={() => void run(() => cancelCheque(id))}>
              {outgoing ? 'إلغاء الشك (يعود المبلغ علينا)' : 'إلغاء هذا الشك'}
            </Button>
          ) : (
            <Button variant="danger" onClick={() => setMode('return')}>
              مرتجع
            </Button>
          )}
        </div>
      )}
    </Modal>
  )
}
