import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/AuthContext.tsx'
import { ApiError } from '../lib/api.ts'
import { createAppointment, listAppointments, updateAppointment } from '../lib/appointments.ts'
import type { Appointment, Doctor } from '../lib/appointments.ts'
import { bookSession } from '../lib/treatments.ts'
import { dayRange, freeStarts, instantAt, isDate, localParts, minuteLabel, todayDate } from '../lib/schedule.ts'
import { useLoad } from '../lib/useLoad.ts'
import { Modal } from './Modal.tsx'
import { PatientPicker } from './PatientPicker.tsx'
import type { PatientPick } from './PatientPicker.tsx'
import { Alert, Button, SelectField, TextAreaField, TextField } from './ui.tsx'

/** Book a new appointment, or move/change an existing one. Only times the doctor is really free are offered. */
/** `forSession`: the appointment is for one planned session of a treatment (the patient is fixed). */
export interface SessionBooking {
  treatmentId: string
  number: number
  patient: PatientPick
  doctorId: string
}

export function AppointmentDialog({ doctors, edit, forSession, initialDate, initialDoctorId, onClose, onSaved }: { doctors: Doctor[]; edit?: Appointment; forSession?: SessionBooking; initialDate?: string; initialDoctorId?: string; onClose: () => void; onSaved: () => void }) {
  const { session } = useAuth()
  const ownDoctor = doctors.find((d) => d.userId === session?.user.id)
  const lockedDoctor = session?.user.role === 'DOCTOR'
  const [patient, setPatient] = useState<PatientPick | null>(forSession ? forSession.patient : edit ? { id: edit.patient.id, fullName: edit.patient.fullName, phone: edit.patient.phone } : null)
  const [doctorId, setDoctorId] = useState(edit?.doctor.id ?? forSession?.doctorId ?? initialDoctorId ?? ownDoctor?.id ?? doctors.find((d) => d.workingPeriods.length > 0)?.id ?? doctors[0]?.id ?? '')
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
      if (forSession) await bookSession(forSession.treatmentId, forSession.number, { doctorId, startsAt, durationMinutes: duration, ...(notes.trim() ? { notes: notes.trim() } : {}) })
      else if (edit) await updateAppointment(edit.id, { doctorId, startsAt, durationMinutes: duration, notes: notes.trim() || null })
      else await createAppointment({ patientId: patient.id, doctorId, startsAt, durationMinutes: duration, ...(notes.trim() ? { notes: notes.trim() } : {}) })
      onSaved()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'صار خطأ غير متوقع، جرب مرة ثانية')
      setBusy(false)
      day.reload() // somebody may have taken the time meanwhile
    }
  }

  return (
    <Modal title={forSession ? `حجز الجلسة ${forSession.number}` : edit ? 'تعديل الموعد' : 'موعد جديد'} onClose={onClose}>
      {edit || forSession ? (
        <p className="text-[15px]">
          المريض: <strong>{forSession ? forSession.patient.fullName : edit?.patient.fullName}</strong>
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
          {edit && !forSession ? 'حفظ التعديل' : 'حجز الموعد'}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          إلغاء
        </Button>
      </div>
    </Modal>
  )
}
