import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../auth/AuthContext.tsx'
import { Card, DateText, Loading } from '../components/admin-ui.tsx'
import { StatusBadge } from '../components/appointment-ui.tsx'
import { ClinicBanner } from '../components/clinic-ui.tsx'
import { PatientPicker } from '../components/PatientPicker.tsx'
import type { PatientPick } from '../components/PatientPicker.tsx'
import { SelectedTeeth, ToothChart, ToothSetToggle } from '../components/ToothChart.tsx'
import { Alert, Button, SelectField, TextAreaField, TextField } from '../components/ui.tsx'
import { ApiError } from '../lib/api.ts'
import { confirmedOnly, listAppointments, listDoctors } from '../lib/appointments.ts'
import type { Appointment, Doctor } from '../lib/appointments.ts'
import { todayInput } from '../lib/format.ts'
import { getPatient } from '../lib/patients.ts'
import { addDays, dayRange, dayTitle, isDate, localParts, timeLabel, todayDate } from '../lib/schedule.ts'
import { ageInYears, defaultSet, setOfTeeth, toothName } from '../lib/teeth.ts'
import type { ToothSet } from '../lib/teeth.ts'
import { buildCreateTreatment, buildEditTreatment, copyTypeToAll, EMPTY_TREATMENT, entriesOf, setEntrySub, setEntryType, toggleEntry, typeIdsOf } from '../lib/treatmentForm.ts'
import type { TreatmentFormValues } from '../lib/treatmentForm.ts'
import { cancelTreatment, createTreatment, getTreatment, listTreatmentTypes, pickableTypes, updateTreatment } from '../lib/treatments.ts'
import type { Treatment, TreatmentType } from '../lib/treatments.ts'
import { useLoad } from '../lib/useLoad.ts'

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'صار خطأ غير متوقع، جرب مرة ثانية')

/** The chart + type + notes + cost + sessions. Shared by "new" and "edit". */
function TreatmentFields({
  birthDate,
  v,
  setV,
  types,
  keep,
  submitLabel,
  busy,
  error,
  onSubmit,
}: {
  birthDate: string | null | undefined
  v: TreatmentFormValues
  setV: (f: (s: TreatmentFormValues) => TreatmentFormValues) => void
  types: TreatmentType[]
  keep: string[]
  submitLabel: string
  busy: boolean
  error: string | null
  onSubmit: () => void
}) {
  // Chosen once when the form opens (by the patient's age, or by the teeth an old treatment already has); the doctor can switch.
  const [set, setSet] = useState<ToothSet>(() => (v.teeth.length > 0 ? setOfTeeth(v.teeth.map((t) => t.code)) : defaultSet(birthDate)))
  const tree = pickableTypes(types, keep)
  const age = ageInYears(birthDate)
  const codes = v.teeth.map((t) => t.code)
  const field = <K extends keyof TreatmentFormValues>(k: K, x: TreatmentFormValues[K]) => setV((s) => ({ ...s, [k]: x }))

  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit()
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Card title="الأسنان" hint={age === null ? 'كبس على السن لاختياره. تقدر تختار أكثر من سن.' : `عمر المريض ${age} سنة. كبس على السن لاختياره، وتقدر تختار أكثر من سن.`}>
        <ToothSetToggle value={set} onChange={setSet} />
        <ToothChart set={set} selected={codes} onPick={(c) => field('teeth', toggleEntry(v.teeth, c))} />
        <SelectedTeeth teeth={codes} onRemove={(c) => field('teeth', toggleEntry(v.teeth, c))} onClear={() => field('teeth', [])} />
      </Card>
      <Card title="العلاج" hint="لكل سن نوع علاجه. التكلفة وعدد الجلسات واحدة للعلاج كله.">
        {tree.length === 0 ? (
          <Alert tone="warning">
            ما في أنواع علاج لسا. <Link to="/treatment-types" className="font-bold underline">أضف أنواع العلاج</Link> وارجع.
          </Alert>
        ) : v.teeth.length === 0 ? (
          <p className="text-[15px] text-muted">اختر الأسنان من المخطط فوق، وبعدين اختر نوع العلاج لكل سن.</p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="tooth-rows">
            {v.teeth.map((t) => {
              const node = tree.find((n) => n.type.id === t.typeId)
              return (
                <li key={t.code} data-tooth-row={t.code} className="flex flex-col gap-3 rounded-xl border border-line bg-page p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-[15px]">{toothName(t.code)}</strong>
                    {v.teeth.length > 1 && t.typeId && (
                      <button type="button" data-action="copy-type" onClick={() => field('teeth', copyTypeToAll(v.teeth, t.code))} className="cursor-pointer text-sm font-semibold text-brand-dark underline">
                        نفس النوع لكل الأسنان
                      </button>
                    )}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SelectField label="نوع العلاج" value={t.typeId} onChange={(e) => field('teeth', setEntryType(v.teeth, t.code, e.target.value))}>
                      <option value="">اختر النوع</option>
                      {tree.map((n) => (
                        <option key={n.type.id} value={n.type.id}>
                          {n.type.name}
                        </option>
                      ))}
                    </SelectField>
                    {node && node.children.length > 0 && (
                      <SelectField label="النوع الفرعي" value={t.subTypeId} onChange={(e) => field('teeth', setEntrySub(v.teeth, t.code, e.target.value))}>
                        <option value="">اختر النوع الفرعي</option>
                        {node.children.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </SelectField>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <TextAreaField label="ملاحظات (اختياري)" value={v.description} maxLength={1000} onChange={(e) => field('description', e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="التكلفة الكلية (₪)" inputMode="decimal" dir="ltr" className="text-right" value={v.cost} onChange={(e) => field('cost', e.target.value)} hint="المبلغ المتفق عليه للعلاج كله" />
          <TextField label="عدد الجلسات" inputMode="numeric" dir="ltr" className="text-right" value={v.sessions} onChange={(e) => field('sessions', e.target.value)} hint="بتتسجل الجلسات تلقائياً، وبتسكّرها من صفحة العلاج" />
        </div>
      </Card>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex gap-3">
        <Button type="submit" busy={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

type Mode = 'with' | 'without'

function ModeChoice({ onPick }: { onPick: (m: Mode) => void }) {
  return (
    <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
      {(
        [
          ['with', 'بموعد', 'العلاج لمريض عنده موعد محجوز، بتختار الموعد من القائمة.'],
          ['without', 'بدون موعد', 'مريض إجا بدون موعد أو العلاج مسجل بعد الزيارة، بتختار المريض والدكتور والتاريخ.'],
        ] as const
      ).map(([m, title, hint]) => (
        <button key={m} type="button" onClick={() => onPick(m)} className="flex cursor-pointer flex-col gap-2 rounded-2xl border-2 border-line bg-white p-6 text-start hover:border-brand">
          <span className="text-xl font-bold">{title}</span>
          <span className="text-sm leading-7 text-muted">{hint}</span>
        </button>
      ))}
    </div>
  )
}

/** Confirmed appointments of one day, with arrows to move between days (the patient may come a day earlier or later than booked). */
function AppointmentList({ onPick }: { onPick: (a: Appointment) => void }) {
  const [day, setDay] = useState(todayDate())
  const { data, error } = useLoad(() => listAppointments(dayRange(day)), [day])
  const rows = confirmedOnly(data ?? [])
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" aria-label="اليوم السابق" onClick={() => setDay(addDays(day, -1))}>
          →
        </Button>
        <input
          type="date"
          aria-label="يوم المواعيد"
          value={day}
          onChange={(e) => isDate(e.target.value) && setDay(e.target.value)}
          className="h-10 rounded-[10px] border-[1.5px] border-brand bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-brand/25"
        />
        <Button variant="secondary" size="sm" aria-label="اليوم التالي" onClick={() => setDay(addDays(day, 1))}>
          ←
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setDay(todayDate())}>
          اليوم
        </Button>
      </div>
      <p className="text-sm font-semibold">{dayTitle(day)}</p>
      {!data ? (
        <Loading error={error} />
      ) : rows.length === 0 ? (
        <p className="text-[15px] text-muted">ما في مواعيد مؤكدة بهذا اليوم. تنقّل بين الأيام (المريض ممكن يجي قبل موعده أو بعده)، أو جرب «بدون موعد».</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="المواعيد المؤكدة">
          {rows.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => onPick(a)} className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-4 text-start hover:border-brand">
                <span className="flex flex-col gap-0.5">
                  <span className="font-bold">{a.patient.fullName}</span>
                  <span className="text-sm text-muted">
                    <bdi dir="ltr">{timeLabel(a.startsAt)}</bdi> · {a.doctor.fullName}
                  </span>
                </span>
                <StatusBadge a={a} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function NewTreatmentPage() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const [params] = useSearchParams()
  const presetPatient = params.get('patientId') ?? ''
  const [mode, setMode] = useState<Mode | null>(presetPatient ? 'without' : null)
  const [v, setVState] = useState<TreatmentFormValues>({ ...EMPTY_TREATMENT, patientId: presetPatient, day: todayInput() })
  const setV = (f: (s: TreatmentFormValues) => TreatmentFormValues) => setVState(f)
  const [patient, setPatient] = useState<PatientPick | null>(null)
  const [apt, setApt] = useState<Appointment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const doctors = useLoad(listDoctors, [])
  const types = useLoad(listTreatmentTypes, [])
  const preset = useLoad(() => (presetPatient ? getPatient(presetPatient) : Promise.resolve(null)), [presetPatient])
  const chosen = useLoad(() => (apt ? getPatient(apt.patient.id) : Promise.resolve(null)), [apt?.patient.id])

  const isDoctor = session?.user.role === 'DOCTOR'
  const ownDoctor = doctors.data?.find((d) => d.userId === session?.user.id)
  const shownPatient: PatientPick | null = apt ? (chosen.data ?? null) : (patient ?? preset.data ?? null)
  const doctorId = apt ? apt.doctor.id : isDoctor ? (ownDoctor?.id ?? '') : v.doctorId || ownDoctor?.id || ''

  function reset(next: Mode | null) {
    setMode(next)
    setApt(null)
    setPatient(null)
    setError(null)
    setVState({ ...EMPTY_TREATMENT, day: todayInput() })
  }

  async function submit() {
    if (!types.data) return
    const r = buildCreateTreatment({ ...v, patientId: shownPatient?.id ?? '', doctorId, appointmentId: apt?.id ?? '' }, types.data)
    if ('error' in r) return setError(r.error)
    setError(null)
    setBusy(true)
    try {
      const t = await createTreatment(r.body)
      navigate(`/treatments/${t.id}`, { state: { created: true } })
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

  const ready = mode !== null && shownPatient !== null && doctorId !== ''
  return (
    <>
      <ClinicBanner title="علاج جديد" subtitle={mode === 'with' ? 'علاج بموعد' : mode === 'without' ? 'علاج بدون موعد' : 'اختر الطريقة'} back={{ to: '/treatments', label: 'رجوع للعلاجات' }} />
      {mode === null && <ModeChoice onPick={reset} />}
      {mode !== null && !presetPatient && (
        <button type="button" onClick={() => reset(null)} className="cursor-pointer self-start text-sm font-semibold text-brand-dark underline">
          تغيير الطريقة
        </button>
      )}

      {mode === 'with' && !apt && (
        <Card title="اختر الموعد" hint="المواعيد المؤكدة فقط. اليوم الحالي ظاهر، وتقدر تتنقل بين الأيام. بعد إنشاء العلاج بينتهي الموعد.">
          <AppointmentList onPick={setApt} />
        </Card>
      )}
      {mode === 'with' && apt && (
        <Card title="الموعد">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              <strong>{apt.patient.fullName}</strong> · {dayTitle(localParts(apt.startsAt).date)} · <bdi dir="ltr">{timeLabel(apt.startsAt)}</bdi> · {apt.doctor.fullName}
            </span>
            <button type="button" onClick={() => setApt(null)} className="cursor-pointer text-sm font-semibold text-brand-dark underline">
              تغيير الموعد
            </button>
          </div>
        </Card>
      )}

      {mode === 'without' && (
        <Card title="المريض والدكتور">
          {presetPatient ? (
            <p className="text-[15px]">
              المريض: <strong>{preset.data?.fullName ?? '...'}</strong>
            </p>
          ) : (
            <PatientPicker value={patient} onChange={setPatient} />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="الدكتور" value={doctorId} disabled={isDoctor} onChange={(e) => setV((s) => ({ ...s, doctorId: e.target.value }))}>
              <option value="">اختر الدكتور</option>
              {(doctors.data ?? []).map((d: Doctor) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </SelectField>
            <TextField label="تاريخ العلاج" type="date" max={todayInput()} value={v.day} onChange={(e) => setV((s) => ({ ...s, day: e.target.value }))} />
          </div>
        </Card>
      )}

      {ready && types.data ? (
        <TreatmentFields birthDate={shownPatient.birthDate} v={v} setV={setV} types={types.data} keep={[]} submitLabel="إنشاء العلاج" busy={busy} error={error} onSubmit={() => void submit()} />
      ) : (
        mode !== null && (!types.data || doctors.loading) && <Loading error={types.error ?? doctors.error} />
      )}
    </>
  )
}

export function EditTreatmentPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { data: t, error } = useLoad(() => getTreatment(id), [id])
  const types = useLoad(listTreatmentTypes, [])
  const patient = useLoad(() => (t ? getPatient(t.patientId) : Promise.resolve(null)), [t?.patientId])
  if (!t || !types.data) return <Loading error={error ?? types.error} />
  return <EditForm key={t.id} t={t} types={types.data} birthDate={patient.data?.birthDate ?? null} onDone={() => navigate(`/treatments/${id}`, { state: { saved: true } })} />
}

function EditForm({ t, types, birthDate, onDone }: { t: Treatment; types: TreatmentType[]; birthDate: string | null; onDone: () => void }) {
  const [v, setV] = useState<TreatmentFormValues>({
    ...EMPTY_TREATMENT,
    patientId: t.patientId,
    doctorId: t.doctorId,
    teeth: entriesOf(t),
    description: t.description ?? '',
    cost: String(t.totalCost / 100),
    sessions: String(t.plannedSessions),
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const navigate = useNavigate()

  async function save() {
    const r = buildEditTreatment(v, types)
    if ('error' in r) return setError(r.error)
    setError(null)
    setBusy(true)
    try {
      await updateTreatment(t.id, r.body)
      onDone()
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }

  async function cancel() {
    setCancelBusy(true)
    setCancelError(null)
    try {
      await cancelTreatment(t.id, reason.trim() || undefined)
      navigate(`/treatments/${t.id}`, { state: { cancelled: true } })
    } catch (e) {
      setCancelError(messageOf(e))
      setCancelBusy(false)
    }
  }

  return (
    <>
      <ClinicBanner title="تعديل العلاج" subtitle={`${t.patient.fullName} · ${t.doctor.fullName}`} back={{ to: `/treatments/${t.id}`, label: 'رجوع لصفحة العلاج' }} />
      {t.status !== 'OPEN' ? (
        <Alert tone="warning">هذا العلاج {t.status === 'CLOSED' ? 'مغلق' : 'ملغي'}، ما بينعدل.</Alert>
      ) : (
        <>
          <TreatmentFields birthDate={birthDate} v={v} setV={(f) => setV(f)} types={types} keep={typeIdsOf(t)} submitLabel="حفظ التعديلات" busy={busy} error={error} onSubmit={() => void save()} />
          <Card title="إلغاء العلاج" hint="بيلغى العلاج إذا ما في دفعات فعّالة عليه. بيضل بالسجل كملغي.">
            <p className="text-sm text-muted">
              بدأ بتاريخ <DateText value={t.startedAt} />
            </p>
            {cancelError && <Alert tone="error">{cancelError}</Alert>}
            {cancelling ? (
              <>
                <TextAreaField label="سبب الإلغاء (اختياري)" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
                <div className="flex gap-2">
                  <Button variant="danger" size="sm" busy={cancelBusy} onClick={() => void cancel()}>
                    تأكيد إلغاء العلاج
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setCancelling(false)}>
                    رجوع
                  </Button>
                </div>
              </>
            ) : (
              <Button variant="secondary" size="sm" className="self-start" onClick={() => setCancelling(true)}>
                إلغاء العلاج
              </Button>
            )}
          </Card>
        </>
      )}
    </>
  )
}
