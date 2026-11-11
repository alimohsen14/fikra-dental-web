import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthContext.tsx'
import { ApiError } from '../lib/api.ts'
import { cancelAppointment, confirmAppointment, countByStatus, finishedOnOtherDay, messageLine, sendMessageNow, STATUS_LABELS, STATUS_STYLE, testReply } from '../lib/appointments.ts'
import type { Appointment, DayFilter, DoctorDay } from '../lib/appointments.ts'
import { canEditTreatments } from '../lib/access.ts'
import { dayTitle, localParts, timeLabel } from '../lib/schedule.ts'
import { useTestMode } from '../lib/useTestMode.ts'
import { Badge } from './admin-ui.tsx'
import { Modal } from './Modal.tsx'
import { Alert, Button, TextAreaField } from './ui.tsx'

/** Counters for one day. Press one to see only those appointments. */
export function StatusCards({ list, value, onChange }: { list: Pick<Appointment, 'status'>[]; value: DayFilter; onChange: (f: DayFilter) => void }) {
  const n = countByStatus(list)
  const cards: [DayFilter, string, number][] = [
    ['ALL', 'مواعيد اليوم', list.length - n.CANCELLED],
    ['PENDING', 'بانتظار التأكيد', n.PENDING],
    ['CONFIRMED', 'مؤكدة', n.CONFIRMED],
    ['COMPLETED', 'منتهية', n.COMPLETED],
    ['CANCELLED', 'ملغية', n.CANCELLED],
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" role="group" aria-label="حالات المواعيد">
      {cards.map(([f, label, count]) => (
        <button
          key={f}
          type="button"
          data-filter={f}
          aria-pressed={value === f}
          onClick={() => onChange(f)}
          className={`flex cursor-pointer flex-col gap-1 rounded-xl border-2 bg-white p-4 text-start ${value === f ? 'border-brand' : 'border-line'}`}
        >
          <span className="text-sm text-muted">{label}</span>
          <span className="text-3xl font-bold text-brand-dark">{count}</span>
        </button>
      ))}
    </div>
  )
}

export const StatusBadge = ({ a }: { a: Appointment }) => <Badge label={STATUS_LABELS[a.status]} {...STATUS_STYLE[a.status]} />

const message = (e: unknown) => (e instanceof ApiError ? e.message : 'حدث خطأ غير متوقع، حاول مرة أخرى')

function CancelModal({ a, onClose, onDone }: { a: Appointment; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await cancelAppointment(a.id, reason.trim() || undefined)
      onDone()
    } catch (e) {
      setError(message(e))
      setBusy(false)
    }
  }
  return (
    <Modal title="إلغاء الموعد" onClose={onClose}>
      <p className="text-[15px]">
        إلغاء موعد <strong>{a.patient.fullName}</strong> الساعة <bdi dir="ltr">{timeLabel(a.startsAt)}</bdi>؟ يبقى الموعد في السجل كملغى، ويعود الوقت متاحاً.
      </p>
      <TextAreaField label="سبب الإلغاء (اختياري)" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap gap-3">
        <Button variant="danger" busy={busy} onClick={submit}>
          تأكيد الإلغاء
        </Button>
        <Button variant="secondary" onClick={onClose}>
          رجوع
        </Button>
      </div>
    </Modal>
  )
}

const LINE_STYLE = { info: 'text-muted', good: 'text-[#0b6b3a]', bad: 'text-[#9b1c1c]', warn: 'text-[#7a4b00]' } as const
const whenLabel = (iso: string) => `${dayTitle(localParts(iso).date)} · ${timeLabel(iso)}`

/** One appointment with the buttons that make sense for its status. */
export function AppointmentCard({ a, onChanged, onEdit, showDoctor = true, showDate = false }: { a: Appointment; onChanged: () => void; onEdit: (a: Appointment) => void; showDoctor?: boolean; showDate?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const navigate = useNavigate()
  const { session } = useAuth()
  const canOpenTreatment = !!session && canEditTreatments(session.user)
  const live = a.status === 'PENDING' || a.status === 'CONFIRMED'
  const testMode = useTestMode()
  const [showText, setShowText] = useState(false)
  const line = messageLine(a, whenLabel)
  const m = a.confirmationMessage
  const sent = m && (m.status === 'SENT' || m.status === 'DELIVERED')
  // eslint-disable-next-line react-hooks/purity -- "has it started yet" is read at render time on purpose
  const started = Date.parse(a.startsAt) <= Date.now()

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className={`flex flex-col gap-3 rounded-xl border bg-white p-4 ${a.overdue ? 'border-[#f0cf8f]' : 'border-line'} ${a.status === 'CANCELLED' ? 'opacity-70' : ''}`} aria-label={`موعد ${a.patient.fullName}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {showDate && <span className="font-bold">{dayTitle(localParts(a.startsAt).date)}</span>}
        <bdi dir="ltr" className="text-lg font-bold whitespace-nowrap">
          {timeLabel(a.startsAt)} – {timeLabel(a.endsAt)}
        </bdi>
        <Link to={`/patients/${a.patient.id}`} className="text-base font-bold text-brand-dark underline">
          {a.patient.fullName}
        </Link>
        <StatusBadge a={a} />
        {a.overdue && <Badge label={a.status === 'PENDING' ? 'فات موعده ولم يُؤكَّد' : 'مرّ وقته ولم يُفتح له علاج'} bg="#fff1d6" fg="#7a4b00" />}
        {a.patient.medicalAlerts && <Badge label="تنبيه طبي" bg="#fde8e8" fg="#9b1c1c" />}
        {a.bookedByPatient && <Badge label="حجز ذاتي عبر واتساب" bg="#e3f5ea" fg="#0b6b3a" />}
        {a.patient.selfRegistered && <Badge label="مسجّل ذاتياً" bg="#efe6fb" fg="#4b2a86" />}
      </div>
      <p className="text-sm text-muted">
        {showDoctor && <>الدكتور {a.doctor.fullName} · </>}
        {a.durationMinutes} دقيقة · <bdi dir="ltr">{a.patient.phone}</bdi>
      </p>
      {a.patient.medicalAlerts && <p className="text-sm text-[#9b1c1c]">⚠ {a.patient.medicalAlerts}</p>}
      {a.notes && <p className="text-sm">{a.notes}</p>}
      {finishedOnOtherDay(a, (iso) => localParts(iso).date) && (
        <p className="text-sm text-muted">
          انتهى بتاريخ {finishedOnOtherDay(a, (iso) => localParts(iso).date)} ({a.completedAt && a.completedAt < a.startsAt ? 'حضر المريض قبل موعده' : 'سُجّل بعد موعده'}).
        </p>
      )}
      {a.status === 'CANCELLED' && a.cancelReason && <p className="text-sm text-muted">سبب الإلغاء: {a.cancelReason}</p>}
      {line && (
        <p className={`text-sm ${LINE_STYLE[line.tone]}`} aria-label="واتساب">
          💬 {line.text}
          {m?.body && (
            <button type="button" className="ms-2 underline" onClick={() => setShowText((v) => !v)}>
              {showText ? 'إخفاء النص' : 'عرض النص'}
            </button>
          )}
        </p>
      )}
      {showText && m?.body && <pre className="rounded-lg bg-[#f4f6f8] p-3 text-sm whitespace-pre-wrap">{m.body}</pre>}
      {error && <Alert tone="error">{error}</Alert>}
      {testMode && a.status === 'PENDING' && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line p-2" aria-label="تجربة واتساب">
          <span className="text-xs text-muted">وضع التجربة:</span>
          {(!m || m.status === 'FAILED') && (
            <Button size="sm" variant="secondary" busy={busy} onClick={() => run(() => sendMessageNow(a.id))}>
              أرسل الرسالة الآن
            </Button>
          )}
          {sent && !m.response && (
            <>
              <Button size="sm" variant="secondary" busy={busy} onClick={() => run(() => testReply(a.id, 'YES'))}>
                المريض رد: نعم
              </Button>
              <Button size="sm" variant="secondary" busy={busy} onClick={() => run(() => testReply(a.id, 'NO'))}>
                المريض رد: لا
              </Button>
            </>
          )}
        </div>
      )}
      {live && (
        <div className="flex flex-wrap gap-2">
          {a.status === 'PENDING' && (
            <Button size="sm" busy={busy} onClick={() => run(() => confirmAppointment(a.id))}>
              تأكيد
            </Button>
          )}
          {started && canOpenTreatment && (
            <Button size="sm" busy={busy} onClick={() => navigate('/treatments/new', { state: { appointment: a } })}>
              إنهاء وفتح علاج
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onEdit(a)}>
            تعديل
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setCancelling(true)}>
            إلغاء
          </Button>
        </div>
      )}
      {cancelling && (
        <CancelModal
          a={a}
          onClose={() => setCancelling(false)}
          onDone={() => {
            setCancelling(false)
            onChanged()
          }}
        />
      )}
    </article>
  )
}

/** One card per doctor for today (owner and secretary). Pressing a card shows only that doctor's appointments; pressing it again shows all. */
export function DoctorCards({ days, value, onChange }: { days: DoctorDay[]; value: string | null; onChange: (id: string | null) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label="الأطباء" data-testid="doctor-cards">
      {days.map((d) => (
        <button
          key={d.doctor.id}
          type="button"
          data-doctor={d.doctor.id}
          aria-pressed={value === d.doctor.id}
          onClick={() => onChange(value === d.doctor.id ? null : d.doctor.id)}
          className={`flex cursor-pointer flex-col gap-1 rounded-xl border-2 bg-white p-4 text-start ${value === d.doctor.id ? 'border-brand' : 'border-line'}`}
        >
          <span className="font-bold">{d.doctor.fullName}</span>
          <span className="text-sm text-muted">
            {d.total === 0 ? 'لا مواعيد له اليوم' : `${d.total} مواعيد اليوم · ${d.completed} منتهية`}
          </span>
          <span className="text-sm text-muted">{d.next ? `التالي ${timeLabel(d.next)}` : d.total > 0 ? 'أنهى مواعيده' : ''}</span>
        </button>
      ))}
    </div>
  )
}
