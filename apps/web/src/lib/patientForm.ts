import { dateOnly } from './format.ts'
import type { Patient } from './patients.ts'

export interface PatientFormValues {
  fullName: string
  phone: string
  gender: '' | 'MALE' | 'FEMALE'
  birthDate: string
  nationalId: string
  region: string
  address: string
  medicalAlerts: string
  notes: string
}

export const EMPTY_PATIENT: PatientFormValues = { fullName: '', phone: '', gender: '', birthDate: '', nationalId: '', region: '', address: '', medicalAlerts: '', notes: '' }

export const patientToForm = (p: Patient): PatientFormValues => ({
  fullName: p.fullName,
  phone: p.phone,
  gender: p.gender ?? '',
  birthDate: p.birthDate ? dateOnly(p.birthDate) : '',
  nationalId: p.nationalId ?? '',
  region: p.region ?? '',
  address: p.address ?? '',
  medicalAlerts: p.medicalAlerts ?? '',
  notes: p.notes ?? '',
})

const FIELDS = Object.keys(EMPTY_PATIENT) as (keyof PatientFormValues)[]

/**
 * Checks the form. For a new patient (`original` omitted) empty optional fields are left out.
 * For an edit only the changed fields are sent, and a cleared field is sent as "" (the API clears it).
 */
export function buildPatientBody(v: PatientFormValues, original?: PatientFormValues, o: { needPhone?: boolean } = {}): { error: string } | { body: Record<string, string> } {
  const needPhone = o.needPhone ?? true
  const t = (k: keyof PatientFormValues) => v[k].trim()
  if (t('fullName').length < 2) return { error: 'اكتب اسم المريض' }
  if (needPhone && !t('phone')) return { error: 'اكتب رقم الهاتف' }
  if (t('nationalId') && t('nationalId').length < 5) return { error: 'رقم الهوية قصير' }
  if (t('birthDate')) {
    const d = new Date(t('birthDate') + 'T00:00:00Z')
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t('birthDate') || d.getUTCFullYear() < 1900 || d > new Date()) return { error: 'تاريخ الميلاد غير صحيح' }
  }
  const body: Record<string, string> = {}
  for (const k of FIELDS) {
    if (k === 'phone' && !needPhone) continue // the patient's own page: the phone comes from WhatsApp
    const now = t(k)
    if (original) {
      if (now !== original[k].trim()) body[k] = now
    } else if (now) body[k] = now
  }
  if (original && Object.keys(body).length === 0) return { error: 'ما في تغيير لحفظه' }
  return { body }
}
