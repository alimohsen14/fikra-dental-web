import { useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../auth/AuthContext.tsx'
import { Card, DateText, Loading } from '../components/admin-ui.tsx'
import { ClinicBanner } from '../components/clinic-ui.tsx'
import { PatientTreatments } from '../components/PatientTreatments.tsx'
import { Alert, Button, SelectField, TextAreaField, TextField } from '../components/ui.tsx'
import { canSeeTreatments } from '../lib/access.ts'
import { ApiError } from '../lib/api.ts'
import { todayInput } from '../lib/format.ts'
import { buildPatientBody, EMPTY_PATIENT, patientToForm } from '../lib/patientForm.ts'
import type { PatientFormValues } from '../lib/patientForm.ts'
import { createPatient, getPatient, setPatientArchived, updatePatient } from '../lib/patients.ts'
import type { Patient } from '../lib/patients.ts'
import { useLoad } from '../lib/useLoad.ts'

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'صار خطأ غير متوقع، جرب مرة ثانية')

function PatientForm({ patient, onSaved }: { patient?: Patient; onSaved: (p: Patient, shared: string[]) => void }) {
  const original = patient ? patientToForm(patient) : undefined
  const [v, setV] = useState<PatientFormValues>(original ?? EMPTY_PATIENT)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof PatientFormValues>(k: K, x: PatientFormValues[K]) => setV((s) => ({ ...s, [k]: x }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const r = buildPatientBody(v, original)
    if ('error' in r) return setError(r.error)
    setError(null)
    setBusy(true)
    try {
      if (patient) onSaved(await updatePatient(patient.id, r.body), [])
      else {
        const res = await createPatient(r.body)
        onSaved(res.patient, res.sharedPhoneWith.map((p) => p.fullName))
      }
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-3xl flex-col gap-5">
      {error && <Alert tone="error">{error}</Alert>}
      <Card title="البيانات الأساسية">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="الاسم الكامل" required value={v.fullName} onChange={(e) => set('fullName', e.target.value)} />
          <TextField label="رقم الهاتف" required dir="ltr" inputMode="tel" className="text-right" value={v.phone} onChange={(e) => set('phone', e.target.value)} hint="مثال: 0599123456" />
          <SelectField label="الجنس" value={v.gender} onChange={(e) => set('gender', e.target.value as PatientFormValues['gender'])}>
            <option value="">غير محدد</option>
            <option value="MALE">ذكر</option>
            <option value="FEMALE">أنثى</option>
          </SelectField>
          <TextField label="تاريخ الميلاد" type="date" dir="ltr" max={todayInput()} className="text-right" value={v.birthDate} onChange={(e) => set('birthDate', e.target.value)} />
          <TextField label="رقم الهوية" dir="ltr" className="text-right" value={v.nationalId} onChange={(e) => set('nationalId', e.target.value)} />
          <TextField label="المنطقة" value={v.region} onChange={(e) => set('region', e.target.value)} />
        </div>
        <TextField label="العنوان" value={v.address} onChange={(e) => set('address', e.target.value)} />
      </Card>
      <Card title="طبي" hint="التنبيه الطبي بيظهر بقائمة المرضى بشارة حمراء عشان ما ينتسى.">
        <TextAreaField label="تنبيهات طبية" placeholder="مثال: حساسية من البنسلين، سكري" value={v.medicalAlerts} onChange={(e) => set('medicalAlerts', e.target.value)} />
        <TextAreaField label="ملاحظات" value={v.notes} onChange={(e) => set('notes', e.target.value)} />
      </Card>
      <div className="flex gap-3">
        <Button type="submit" busy={busy}>
          {patient ? 'حفظ التعديلات' : 'إضافة المريض'}
        </Button>
      </div>
    </form>
  )
}

export function NewPatientPage() {
  const navigate = useNavigate()
  return (
    <>
      <ClinicBanner title="مريض جديد" back={{ to: '/patients', label: 'رجوع للمرضى' }} />
      <PatientForm onSaved={(p, shared) => navigate(`/patients/${p.id}`, { state: { created: true, shared } })} />
    </>
  )
}

export function PatientPage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const state = location.state as { created?: boolean; shared?: string[] } | null
  const { data: patient, error, reload } = useLoad(() => getPatient(id), [id])
  const { session } = useAuth()
  const [params, setParams] = useSearchParams()
  const hasTreatments = session ? canSeeTreatments(session.user) : false
  const tab = hasTreatments && params.get('tab') === 'treatments' ? 'treatments' : 'info'
  const [saved, setSaved] = useState(false)
  const [asking, setAsking] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!patient) return <Loading error={error} />
  const archived = patient.archivedAt !== null

  async function toggleArchive() {
    setBusy(true)
    setArchiveError(null)
    try {
      await setPatientArchived(patient!.id, !archived)
      setAsking(false)
      reload()
    } catch (e) {
      setArchiveError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ClinicBanner title={patient.fullName} subtitle={archived ? 'هذا المريض بالأرشيف' : undefined} back={{ to: '/patients', label: 'رجوع للمرضى' }} />
      {hasTreatments && (
        <div role="tablist" aria-label="ملف المريض" className="flex gap-2">
          {(
            [
              ['info', 'البيانات'],
              ['treatments', 'العلاجات'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={tab === v}
              onClick={() => setParams(v === 'info' ? {} : { tab: v }, { replace: true })}
              className={`h-10 cursor-pointer rounded-full border px-5 text-sm font-semibold ${tab === v ? 'border-brand bg-brand text-on-brand' : 'border-line bg-white'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === 'treatments' && <PatientTreatments patientId={patient.id} birthDate={patient.birthDate} />}
      {tab === 'info' && state?.created && <Alert tone="success">تمت إضافة المريض.</Alert>}
      {tab === 'info' && state?.shared && state.shared.length > 0 && <Alert tone="warning">نفس رقم الهاتف مسجل لـ: {state.shared.join('، ')}. (طبيعي إذا كانوا من نفس العائلة.)</Alert>}
      {tab === 'info' && saved && <Alert tone="success">تم حفظ التعديلات.</Alert>}
      {tab === 'info' && (<>
      <PatientForm
        key={patient.id + patient.createdAt + JSON.stringify(patientToForm(patient))}
        patient={patient}
        onSaved={() => {
          setSaved(true)
          reload()
        }}
      />
      <Card title={archived ? 'إرجاع من الأرشيف' : 'أرشفة المريض'} hint={archived ? 'بيرجع يظهر بقائمة المرضى.' : 'المريض ما بينحذف أبداً، بس بيختفي من القائمة العادية وبتلاقيه بتبويب الأرشيف.'}>
        <p className="text-[13px] text-muted">
          أضيف بتاريخ <DateText value={patient.createdAt} />
        </p>
        {archiveError && <Alert tone="error">{archiveError}</Alert>}
        {asking || archived ? (
          <div className="flex gap-2">
            <Button variant={archived ? 'primary' : 'danger'} size="sm" busy={busy} onClick={() => void toggleArchive()}>
              {archived ? 'إرجاع المريض' : 'تأكيد الأرشفة'}
            </Button>
            {asking && (
              <Button variant="secondary" size="sm" onClick={() => setAsking(false)}>
                رجوع
              </Button>
            )}
          </div>
        ) : (
          <Button variant="secondary" size="sm" className="self-start" onClick={() => setAsking(true)}>
            أرشفة المريض
          </Button>
        )}
      </Card>
      </>)}
    </>
  )
}
