import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { useAuth } from '../auth/AuthContext.tsx'
import { Badge, Card, DateText, Loading, Money } from '../components/admin-ui.tsx'
import { AppointmentDialog } from '../components/AppointmentDialog.tsx'
import { BannerLink, ClinicBanner } from '../components/clinic-ui.tsx'
import { Modal } from '../components/Modal.tsx'
import { toothName, toothOrder } from '../lib/teeth.ts'
import { Alert, Button, SelectField, TextAreaField, TextField } from '../components/ui.tsx'
import { canEditTreatments } from '../lib/access.ts'
import { ApiError } from '../lib/api.ts'
import { listDoctors } from '../lib/appointments.ts'
import { todayInput } from '../lib/format.ts'
import { localParts, timeLabel } from '../lib/schedule.ts'
import { buildTreatmentPayment } from '../lib/treatmentForm.ts'
import { addPayment, canClose, closeTreatment, completeSession, getTreatment, METHOD_LABELS, nextBookable, sessionsDone, STATUS_TEXT, TREATMENT_STYLE, typeLabel, typeLabels, voidPayment } from '../lib/treatments.ts'
import type { PaymentMethod, PaymentRow, SessionRow, Treatment } from '../lib/treatments.ts'
import { useLoad } from '../lib/useLoad.ts'

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'صار خطأ غير متوقع، جرب مرة ثانية')

export const TreatmentBadge = ({ status }: { status: Treatment['status'] }) => <Badge label={STATUS_TEXT[status]} {...TREATMENT_STYLE[status]} />

function CompleteSessionModal({ t, s, onClose, onDone }: { t: Treatment; s: SessionRow; onClose: () => void; onDone: () => void }) {
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await completeSession(t.id, s.number, notes.trim() || undefined)
      onDone()
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }
  return (
    <Modal title={`إنهاء الجلسة ${s.number}`} onClose={onClose}>
      <p className="text-[15px]">
        تأكيد إنهاء الجلسة <strong>{s.number}</strong> من <strong>{t.plannedSessions}</strong> للمريض <strong>{t.patient.fullName}</strong>؟ ما بتتراجع.
      </p>
      <TextAreaField label="ملاحظات الجلسة (اختياري)" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap gap-3">
        <Button busy={busy} onClick={() => void submit()}>
          تم إنهاء الجلسة
        </Button>
        <Button variant="secondary" onClick={onClose}>
          رجوع
        </Button>
      </div>
    </Modal>
  )
}

/** Closing is always a button: it appears only when every session is done and everything is paid. */
function CloseCard({ t, onChanged }: { t: Treatment; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function close() {
    setBusy(true)
    setError(null)
    try {
      await closeTreatment(t.id)
      onChanged()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'صار خطأ غير متوقع، جرب مرة ثانية')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card title="إغلاق العلاج" hint="بعد الإغلاق ما بينعدل العلاج ولا بتنضاف عليه دفعات.">
      {error && <Alert tone="error">{error}</Alert>}
      <div>
        <Button busy={busy} onClick={() => void close()}>
          إغلاق العلاج
        </Button>
      </div>
    </Card>
  )
}

function SessionsCard({ t, canEdit, onChanged }: { t: Treatment; canEdit: boolean; onChanged: () => void }) {
  const [finishing, setFinishing] = useState<SessionRow | null>(null)
  const [booking, setBooking] = useState<SessionRow | null>(null)
  const doctors = useLoad(listDoctors, [])
  const next = nextBookable(t)
  const done = sessionsDone(t)
  return (
    <Card title="الجلسات" hint={t.status === 'OPEN' && canEdit ? 'كبس على الجلسة لما تخلص عشان تصير خضراء.' : undefined}>
      <p className="text-sm text-muted" data-testid="sessions-count">
        تمت {done} من {t.plannedSessions}
      </p>
      <ol className="flex flex-wrap gap-3" aria-label="الجلسات">
        {t.sessions.map((s) => {
          const completed = s.status === 'COMPLETED'
          const apt = s.appointment && s.appointment.status !== 'CANCELLED' ? s.appointment : null
          const clickable = !completed && canEdit && t.status === 'OPEN'
          return (
            <li key={s.id} className="flex w-20 flex-col items-center gap-1.5">
              <button
                type="button"
                data-session={s.number}
                data-done={completed}
                disabled={!clickable}
                aria-label={`الجلسة ${s.number}، ${completed ? 'منتهية' : 'لم تتم'}`}
                title={completed && s.notes ? s.notes : undefined}
                onClick={() => setFinishing(s)}
                className={`flex size-14 items-center justify-center rounded-xl border-2 text-lg font-bold ${completed ? 'border-[#1f9d55] bg-[#1f9d55] text-white' : 'border-[#8da2bd] bg-white text-ink'} ${clickable ? 'cursor-pointer hover:border-brand' : 'cursor-default'}`}
              >
                {completed ? '✓' : s.number}
              </button>
              {apt ? (
                <span className="text-center text-xs leading-5 text-muted" data-testid={`session-${s.number}-apt`}>
                  <bdi dir="ltr">
                    {localParts(apt.startsAt).date.slice(5)} {timeLabel(apt.startsAt)}
                  </bdi>
                </span>
              ) : completed && s.completedAt ? (
                <span className="text-xs text-muted">
                  <DateText value={s.completedAt} />
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>
      {next && doctors.data && (
        <Button className="self-start" onClick={() => setBooking(next)}>
          احجز الجلسة الجاية
        </Button>
      )}
      {finishing && (
        <CompleteSessionModal
          t={t}
          s={finishing}
          onClose={() => setFinishing(null)}
          onDone={() => {
            setFinishing(null)
            onChanged()
          }}
        />
      )}
      {booking && doctors.data && (
        <AppointmentDialog
          doctors={doctors.data}
          forSession={{ treatmentId: t.id, number: booking.number, patient: { id: t.patient.id, fullName: t.patient.fullName, phone: '' }, doctorId: t.doctorId }}
          onClose={() => setBooking(null)}
          onSaved={() => {
            setBooking(null)
            onChanged()
          }}
        />
      )}
    </Card>
  )
}

function PaymentModal({ t, remaining, onClose, onDone }: { t: Treatment; remaining: number; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ amount: '', method: 'CASH' as PaymentMethod, day: todayInput(), note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    const r = buildTreatmentPayment(f, remaining)
    if ('error' in r) return setError(r.error)
    setBusy(true)
    setError(null)
    try {
      await addPayment(t.id, r.body)
      onDone()
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }
  return (
    <Modal title="دفعة جديدة" onClose={onClose}>
      <p className="text-sm text-muted">
        المتبقي على العلاج: <Money agorot={remaining} />
      </p>
      <TextField label="المبلغ (₪)" inputMode="decimal" dir="ltr" className="text-right" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
      <SelectField label="طريقة الدفع" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PaymentMethod })}>
        {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
          <option key={m} value={m}>
            {METHOD_LABELS[m]}
          </option>
        ))}
      </SelectField>
      <TextField label="تاريخ الدفعة" type="date" max={todayInput()} value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} />
      <TextAreaField label="ملاحظة (اختياري)" value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap gap-3">
        <Button busy={busy} onClick={() => void submit()}>
          تسجيل الدفعة
        </Button>
        <Button variant="secondary" onClick={onClose}>
          رجوع
        </Button>
      </div>
    </Modal>
  )
}

function VoidModal({ p, onClose, onDone }: { p: PaymentRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    if (reason.trim().length < 2) return setError('اكتب سبب الإلغاء')
    setBusy(true)
    setError(null)
    try {
      await voidPayment(p.id, reason.trim())
      onDone()
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }
  return (
    <Modal title="إلغاء الدفعة" onClose={onClose}>
      <p className="text-[15px]">
        إلغاء دفعة بقيمة <strong><Money agorot={p.amount} /></strong>؟ الدفعة بتضل ظاهرة بالسجل كملغية، والمبلغ بيرجع مطلوب.
      </p>
      <TextAreaField label="سبب الإلغاء" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap gap-3">
        <Button variant="danger" busy={busy} onClick={() => void submit()}>
          تأكيد الإلغاء
        </Button>
        <Button variant="secondary" onClick={onClose}>
          رجوع
        </Button>
      </div>
    </Modal>
  )
}

function MoneyCard({ t, isOwner, onChanged }: { t: Treatment; isOwner: boolean; onChanged: () => void }) {
  const [paying, setPaying] = useState(false)
  const [voiding, setVoiding] = useState<PaymentRow | null>(null)

  if (t.paid === undefined || t.remaining === undefined || !t.payments) {
    return (
      <Card title="التكلفة">
        <p className="text-[15px]">
          التكلفة المتفق عليها: <strong><Money agorot={t.totalCost} /></strong>
        </p>
        <p className="text-sm text-muted">تفاصيل الدفعات للمالك ولمن عنده صلاحية الدفعات.</p>
      </Card>
    )
  }
  const pct = t.totalCost === 0 ? 100 : Math.min(100, Math.round((t.paid / t.totalCost) * 100))
  const stats: [string, number, string][] = [
    ['التكلفة الكلية', t.totalCost, 'total'],
    ['المدفوع', t.paid, 'paid'],
    ['المتبقي', t.remaining, 'remaining'],
  ]
  return (
    <Card title="الدفعات">
      <div className="grid grid-cols-3 gap-3">
        {stats.map(([label, amount, key]) => (
          <div key={key} className="flex flex-col gap-1 rounded-xl border border-line p-3" data-testid={`money-${key}`}>
            <span className="text-sm text-muted">{label}</span>
            <span className="text-xl font-bold text-brand-dark">
              <Money agorot={amount} />
            </span>
          </div>
        ))}
      </div>
      <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="نسبة المدفوع" className="h-2.5 overflow-hidden rounded-full bg-page">
        <div className="h-full bg-[#1f9d55]" style={{ width: `${pct}%` }} />
      </div>
      {t.status === 'OPEN' && t.remaining > 0 && (
        <Button className="self-start" onClick={() => setPaying(true)}>
          دفعة جديدة
        </Button>
      )}
      {t.payments.length === 0 ? (
        <p className="text-[15px] text-muted">ما في دفعات لسا.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="الدفعات">
          {t.payments.map((p) => (
            <li key={p.id} data-testid="payment" data-status={p.status} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3 ${p.status === 'VOIDED' ? 'bg-page text-muted' : 'bg-white'}`}>
              <span className="flex flex-col gap-0.5">
                <span className={`text-lg font-bold ${p.status === 'VOIDED' ? 'line-through' : ''}`}>
                  <Money agorot={p.amount} />
                </span>
                <span className="text-sm">
                  {METHOD_LABELS[p.method]} · <DateText value={p.paidAt} />
                  {p.note ? ` · ${p.note}` : ''}
                </span>
                {p.status === 'VOIDED' && <span className="text-sm text-[#9b1c1c]">ملغية: {p.voidReason}</span>}
              </span>
              {p.status === 'ACTIVE' && isOwner && (
                <Button size="sm" variant="secondary" onClick={() => setVoiding(p)}>
                  إلغاء الدفعة
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {paying && (
        <PaymentModal
          t={t}
          remaining={t.remaining}
          onClose={() => setPaying(false)}
          onDone={() => {
            setPaying(false)
            onChanged()
          }}
        />
      )}
      {voiding && (
        <VoidModal
          p={voiding}
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null)
            onChanged()
          }}
        />
      )}
    </Card>
  )
}

/** Where the treatment stands, in one sentence. */
function statusNote(t: Treatment, canEdit: boolean): { tone: 'success' | 'warning'; text: string } | null {
  if (t.status === 'CLOSED') return { tone: 'success', text: 'العلاج مغلق: مدفوع بالكامل وكل الجلسات تمت.' }
  if (t.status === 'CANCELLED') return { tone: 'warning', text: 'هذا العلاج ملغي.' }
  const allDone = sessionsDone(t) === t.sessions.length
  if (canClose(t)) return { tone: 'success', text: canEdit ? 'كل الجلسات تمت والمبلغ كله انستلم. تقدر تغلق العلاج.' : 'كل الجلسات تمت والمبلغ كله انستلم. الدكتور أو المالك بيغلق العلاج.' }
  if (t.remaining === 0 && !allDone) return { tone: 'warning', text: 'مدفوع بالكامل. بيظهر زر إغلاق العلاج لما تخلص كل الجلسات.' }
  if (allDone && t.remaining !== undefined && t.remaining > 0) return { tone: 'warning', text: 'كل الجلسات تمت. بيظهر زر إغلاق العلاج لما يندفع المتبقي.' }
  return null
}

export default function TreatmentPage() {
  const { id = '' } = useParams()
  const { session } = useAuth()
  const location = useLocation()
  const flash = location.state as { created?: boolean; saved?: boolean; cancelled?: boolean } | null
  const { data: t, error, reload } = useLoad(() => getTreatment(id), [id])
  if (!t || !session) return <Loading error={error} />
  const canEdit = canEditTreatments(session.user)
  const note = statusNote(t, canEdit)
  return (
    <>
      <ClinicBanner
        title={t.patient.fullName}
        subtitle={typeLabels(t).join('، ')}
        back={{ to: `/patients/${t.patientId}?tab=treatments`, label: 'رجوع لملف المريض' }}
        action={
          canEdit && t.status === 'OPEN' ? (
            <BannerLink to={`/treatments/${t.id}/edit`}>تعديل العلاج</BannerLink>
          ) : undefined
        }
      />
      {flash?.created && <Alert tone="success">تم إنشاء العلاج.</Alert>}
      {flash?.saved && <Alert tone="success">تم حفظ التعديلات.</Alert>}
      {flash?.cancelled && <Alert tone="success">تم إلغاء العلاج.</Alert>}
      {note && <Alert tone={note.tone}>{note.text}</Alert>}
      <Card>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[15px]">
          <TreatmentBadge status={t.status} />
          <span>
            الدكتور: <strong>{t.doctor.fullName}</strong>
          </span>
          <span>
            بدأ بتاريخ <DateText value={t.startedAt} />
          </span>
          <Link to={`/patients/${t.patientId}?tab=treatments`} className="font-bold text-brand-dark underline">
            ملف المريض
          </Link>
        </div>
        <ul className="flex flex-col gap-2" data-testid="tooth-types" aria-label="الأسنان وعلاج كل سن">
          {[...t.teeth]
            .sort((a, b) => toothOrder(a.toothCode) - toothOrder(b.toothCode))
            .map((x) => (
              <li key={x.toothCode} data-tooth-row={x.toothCode} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-tint px-4 py-2.5 text-sm text-brand-dark">
                <span className="font-semibold">{toothName(x.toothCode)}</span>
                <span className="font-bold">{typeLabel(x.treatmentType)}</span>
              </li>
            ))}
        </ul>
        {t.description && <p className="rounded-xl bg-page p-3 text-[15px] leading-7">{t.description}</p>}
        {t.sessions.some((s) => s.appointment && s.appointment.status !== 'CANCELLED') && (
          <ul className="flex flex-wrap gap-2 text-sm">
            {t.sessions
              .filter((s) => s.appointment && s.appointment.status !== 'CANCELLED')
              .map((s) => (
                <li key={s.id} className="flex items-center gap-2 rounded-lg bg-brand-tint px-3 py-1.5 text-brand-dark">
                  <span>موعد الجلسة {s.number}:</span>
                  <bdi dir="ltr">
                    {localParts(s.appointment!.startsAt).date} {timeLabel(s.appointment!.startsAt)}
                  </bdi>
                </li>
              ))}
          </ul>
        )}
      </Card>
      <SessionsCard t={t} canEdit={canEdit} onChanged={reload} />
      <MoneyCard t={t} isOwner={session.user.role === 'OWNER'} onChanged={reload} />
      {canEdit && canClose(t) && <CloseCard t={t} onChanged={reload} />}
    </>
  )
}
