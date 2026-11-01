import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/AuthContext.tsx'
import { ApiError } from '../lib/api.ts'
import { createAppointment, listAppointments, updateAppointment } from '../lib/appointments.ts'
import type { Appointment, Doctor } from '../lib/appointments.ts'
import { listPatients } from '../lib/patients.ts'
import type { Patient } from '../lib/patients.ts'
import { dayRange, freeStarts, instantAt, isDate, localParts, minuteLabel, todayDate } from '../lib/schedule.ts'
import { useLoad } from '../lib/useLoad.ts'
import { Modal } from './Modal.tsx'
import { Alert, Button, SelectField, TextAreaField, TextField } from './ui.tsx'

type PatientPick = Pick<Patient, 'id' | 'fullName' | 'phone'>

function PatientPicker({ value, onChange }: { value: PatientPick | null; onChange: (p: PatientPick | null) => void }) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])
  const { data } = useLoad(() => (debounced.length >= 2 ? listPatients({ q: debounced, page: 1, archived: false }) : Promise.resolve(null)), [debounced])

  if (value)
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">المريض</span>
        <div className="flex items-center justify-between gap-3 rounded-xl border-[1.5px] border-brand bg-brand-tint px-4 py-3">
          <span className="font-bold">{value.fullName}</span>
          <button type="button" onClick={() => onChange(null)} className="cursor-pointer text-sm font-semibold text-brand-dark underline">
            تغيير
          </button>
        </div>
      </div>
    )
  return (
    <div className="flex flex-col gap-2">
      <TextField label="المريض" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو الهاتف" hint="اكتب حرفين على الأقل" />
      {data && (
        <ul className="max-h-48 overflow-y-auto rounded-xl border border-line">
          {data.items.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onChange(p)} className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-start hover:bg-page">
                <span className="font-semibold">{p.fullName}</span>
                <bdi dir="ltr" className="text-sm text-muted">
                  {p.phone}
                </bdi>
              </button>
            </li>
          ))}
          {data.items.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted">
              ما في مريض بهالبحث. <Link to="/patients/new" className="font-bold text-brand-dark underline">أضف مريض جديد</Link>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

/** Book a new appointment, or move/change an existing one. Only times the doctor is really free are offered. */
export function AppointmentDialog({ doctors, edit, initialDate, initialDoctorId, onClose, onSaved }: { doctors: Doctor[]; edit?: Appointment; initialDate?: string; initialDoctorId?: string; onClose: () => void; onSaved: () => void }) {
  const { session } = useAuth()
  const ownDoctor = doctors.find((d) => d.userId === session?.user.id)
  const lockedDoctor = session?.user.role === 'DOCTOR'
  const [patient, setPatient] = useState<PatientPick | null>(edit ? { id: edit.patient.id, fullName: edit.patient.fullName, phone: edit.patient.phone } : null)
  const [doctorId, setDoctorId] = useState(edit?.doctor.id ?? initialDoctorId ?? ownDoctor?.id ?? doctors.find((d) => d.workingPeriods.length > 0)?.id ?? doctors[0]?.id ?? '')
  const [date, setDate] = useState(edit ? localParts(edit.startsAt).date : (initialDate ?? todayDate()))
  const [duration, setDuration] = useState<30 | 60>(edit?.durationMinutes === 60 ? 60 : 30)
  const [start, setStart] = useState<number | null>(edit ? localParts(edit.startsAt).minute : null)
  const [notes, setNotes] = useState(edit?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const doctor = doctors.find((d) => d.id === doctorId)
  const dateOk = isDate(date)
  const day = useLoad(() => (dateOk && doctorId ? listAppointments({ ...dayRange(date), doctorId }) : Promise.resolve([] as Appointment[])), [date, dateOk, doctorId])
  const slots = dateOk && doctor && day.data ? freeStarts({ date, periods: doctor.workingPeriods, busy: day.data, duration, ignoreId: edit?.id }) : []
  const noHours = doctor !== undefined && doctor.workingPeriods.length === 0

  async function submit() {
    if (!patient) return setError('اختر المريض')
    if (start === null || !slots.includes(start)) return setError('اختر وقتاً من الأوقات المتاحة')
    setBusy(true)
    setError(null)
    const startsAt = instantAt(date, start).toISOString()
    try {
      if (edit) await updateAppointment(edit.id, { doctorId, startsAt, durationMinutes: duration, notes: notes.trim() || null })
      else await createAppointment({ patientId: patient.id, doctorId, startsAt, durationMinutes: duration, ...(notes.trim() ? { notes: notes.trim() } : {}) })
      onSaved()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'صار خطأ غير متوقع، جرب مرة ثانية')
      setBusy(false)
      day.reload() // somebody may have taken the time meanwhile
    }
  }

  return (
    <Modal title={edit ? 'تعديل الموعد' : 'موعد جديد'} onClose={onClose}>
      {edit ? (
        <p className="text-[15px]">
          المريض: <strong>{edit.patient.fullName}</strong>
        </p>
      ) : (
        <PatientPicker value={patient} onChange={setPatient} />
      )}
      <SelectField
        label="الدكتور"
        value={doctorId}
        disabled={lockedDoctor}
        onChange={(e) => {
          setDoctorId(e.target.value)
          setStart(null)
        }}
      >
        {doctors.map((d) => (
          <option key={d.id} value={d.id}>
            {d.fullName}
          </option>
        ))}
      </SelectField>
      <TextField
        label="اليوم"
        type="date"
        value={date}
        min={todayDate()}
        onChange={(e) => {
          setDate(e.target.value)
          setStart(null)
        }}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">المدة</legend>
        <div className="flex gap-2">
          {([30, 60] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={duration === m}
              onClick={() => {
                setDuration(m)
                setStart(null)
              }}
              className={`h-11 cursor-pointer rounded-full border px-5 text-sm font-semibold ${duration === m ? 'border-brand bg-brand text-on-brand' : 'border-line bg-white'}`}
            >
              {m === 30 ? 'نص ساعة' : 'ساعة'}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">الأوقات المتاحة</legend>
        {!dateOk ? (
          <p className="text-sm text-muted">اختر يوماً صحيحاً.</p>
        ) : noHours ? (
          <Alert tone="warning">
            هذا الدكتور ما إله أوقات دوام، فما بنقدر نحجز عنده.{' '}
            {session?.user.role === 'OWNER' ? <Link to="/hours" className="font-bold underline">حدد أوقات الدوام</Link> : 'اطلب من المالك يحدد أوقات الدوام.'}
          </Alert>
        ) : !day.data ? (
          <p className="text-sm text-muted">جاري التحميل...</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-muted">ما في أوقات متاحة بهذا اليوم. جرب يوماً ثانياً أو مدة أقصر.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {slots.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={start === s}
                onClick={() => setStart(s)}
                className={`h-10 min-w-20 cursor-pointer rounded-lg border px-3 text-sm font-semibold ${start === s ? 'border-brand bg-brand text-on-brand' : 'border-line bg-white hover:bg-page'}`}
              >
                <bdi dir="ltr">{minuteLabel(s)}</bdi>
              </button>
            ))}
          </div>
        )}
      </fieldset>
      <TextAreaField label="ملاحظات (اختياري)" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap gap-3">
        <Button busy={busy} onClick={submit}>
          {edit ? 'حفظ التعديل' : 'حجز الموعد'}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          إلغاء
        </Button>
      </div>
    </Modal>
  )
}
