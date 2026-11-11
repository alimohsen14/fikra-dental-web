import { useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext.tsx'
import { Card, Loading } from './admin-ui.tsx'
import { XrayGallery } from './XrayGallery.tsx'
import { Alert, Button, TextField } from './ui.tsx'
import { ApiError } from '../lib/api.ts'
import { listPatientXrays, listTreatmentXrays, prepareXray, uploadXray, XRAY_MAX_BYTES, xrayFileError } from '../lib/xrays.ts'
import type { Xray } from '../lib/xrays.ts'
import { useLoad } from '../lib/useLoad.ts'

/** The owner can remove any X-ray; a doctor only the ones they added. */
function useCanDelete() {
  const { session } = useAuth()
  return (x: Xray) => !!session && (session.user.role === 'OWNER' || (session.user.role === 'DOCTOR' && x.uploadedByUserId === session.user.id))
}

/** On the treatment page: the X-rays of this treatment, and (owner / doctors) a way to add one. */
export function XraysCard({ treatmentId, canAdd }: { treatmentId: string; canAdd: boolean }) {
  const list = useLoad(() => listTreatmentXrays(treatmentId), [treatmentId])
  const canDelete = useCanDelete()
  const input = useRef<HTMLInputElement>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState(false)

  async function pick(file: File | undefined) {
    if (!file) return
    setError(null)
    setAdded(false)
    const bad = xrayFileError(file)
    if (bad) return setError(bad)
    setBusy(true)
    try {
      const image = await prepareXray(file)
      if (image.size > XRAY_MAX_BYTES) throw new ApiError(413, 'الصورة كبيرة، الحد الأقصى 10 ميجابايت')
      await uploadXray(treatmentId, image, note)
      setNote('')
      setAdded(true)
      list.reload()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'حدث خطأ غير متوقع، حاول مرة أخرى')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <Card title="صور الأشعة" hint="تُحفظ مع تاريخ الإضافة، وتظهر أيضاً في ملف المريض.">
      {canAdd && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <TextField label="ملاحظة (اختياري)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="مثال: بانوراما قبل الحشوة" />
          </div>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="اختيار صورة" data-testid="xray-input" onChange={(e) => void pick(e.target.files?.[0])} />
          <Button busy={busy} onClick={() => input.current?.click()}>
            إضافة صورة أشعة
          </Button>
        </div>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {added && <Alert tone="success">تمت إضافة الصورة.</Alert>}
      {!list.data ? <Loading error={list.error} /> : <XrayGallery items={list.data} canDelete={canDelete} onChanged={list.reload} />}
    </Card>
  )
}

/** In the patient's record: every X-ray of this patient, from all their treatments. Everyone who opens the record can look. */
export function PatientXrays({ patientId }: { patientId: string }) {
  const list = useLoad(() => listPatientXrays(patientId), [patientId])
  const canDelete = useCanDelete()
  if (!list.data) return <Loading error={list.error} />
  return (
    <Card title="صور الأشعة" hint="كل أشعة المريض من جميع علاجاته، الأحدث أولاً. لإضافة صورة افتح العلاج.">
      <XrayGallery items={list.data} canDelete={canDelete} showTreatment onChanged={list.reload} />
    </Card>
  )
}
