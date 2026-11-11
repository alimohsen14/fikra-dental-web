import { useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { flashState } from '../lib/flash.ts'
import { useAuth } from '../auth/AuthContext.tsx'
import { Card, DateText, Loading } from '../components/admin-ui.tsx'
import { ClinicBanner } from '../components/clinic-ui.tsx'
import { PatientFields } from '../components/PatientFields.tsx'
import { PatientTreatments } from '../components/PatientTreatments.tsx'
import { PatientXrays } from '../components/XraysCard.tsx'
import { Alert, Button } from '../components/ui.tsx'
import { canSeeTreatments } from '../lib/access.ts'
import { ApiError } from '../lib/api.ts'
import { buildPatientBody, EMPTY_PATIENT, patientToForm } from '../lib/patientForm.ts'
import type { PatientFormValues } from '../lib/patientForm.ts'
import { createPatient, getPatient, setPatientArchived, updatePatient } from '../lib/patients.ts'
import type { Patient } from '../lib/patients.ts'
import { useLoad } from '../lib/useLoad.ts'

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'حدث خطأ غير متوقع، حاول مرة أخرى')

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
      <PatientFields v={v} set={set} />
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
      <PatientForm onSaved={(p, shared) => navigate('/patients', { state: shared.length > 0 ? flashState(`تمت إضافة ${p.fullName}. نفس رقم الهاتف مسجل لـ: ${shared.join('، ')} (طبيعي إذا كانوا من نفس العائلة).`, 'warning') : flashState(`تمت إضافة ${p.fullName}.`) })} />
    </>
  )
}

export function PatientPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { created?: boolean; shared?: string[] } | null
  const { data: patient, error, reload } = useLoad(() => getPatient(id), [id])
  const { session } = useAuth()
  const [params, setParams] = useSearchParams()
  const hasTreatments = session ? canSeeTreatments(session.user) : false
  const wanted = params.get('tab')
  const tab = wanted === 'xrays' ? 'xrays' : hasTreatments && wanted === 'treatments' ? 'treatments' : 'info'
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
      {(
        <div role="tablist" aria-label="ملف المريض" className="flex gap-2">
          {(
            [
              ['info', 'البيانات'],
              ...(hasTreatments ? ([['treatments', 'العلاجات']] as const) : []),
              ['xrays', 'الأشعة'],
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
      {tab === 'xrays' && <PatientXrays patientId={patient.id} />}
      {tab === 'treatments' && <PatientTreatments patientId={patient.id} birthDate={patient.birthDate} />}
      {tab === 'info' && state?.created && <Alert tone="success">تمت إضافة المريض.</Alert>}
      {tab === 'info' && state?.shared && state.shared.length > 0 && <Alert tone="warning">نفس رقم الهاتف مسجل لـ: {state.shared.join('، ')}. (طبيعي إذا كانوا من نفس العائلة.)</Alert>}
      {tab === 'info' && (<>
      <PatientForm
        key={patient.id + patient.createdAt + JSON.stringify(patientToForm(patient))}
        patient={patient}
        onSaved={(p) => navigate('/patients', { state: flashState(`تم حفظ تعديلات ${p.fullName}.`) })}
      />
      <Card title={archived ? 'إرجاع من الأرشيف' : 'أرشفة المريض'} hint={archived ? 'يعود إلى الظهور في قائمة المرضى.' : 'لا يُحذف المريض أبداً، بل يختفي من القائمة العادية ويمكنك إيجاده في تبويب الأرشيف.'}>
        <p className="text-[13px] text-muted">
          أُضيف بتاريخ <DateText value={patient.createdAt} />
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
