import { Card } from './admin-ui.tsx'
import { SelectField, TextAreaField, TextField } from './ui.tsx'
import { todayInput } from '../lib/format.ts'
import type { PatientFormValues } from '../lib/patientForm.ts'

/** The patient form fields, shared by the clinic staff form and the patient's own registration page (which has no phone field). */
export function PatientFields({ v, set, showPhone = true }: { v: PatientFormValues; set: <K extends keyof PatientFormValues>(k: K, x: PatientFormValues[K]) => void; showPhone?: boolean }) {
  return (
    <>
      <Card title="البيانات الأساسية">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="الاسم الكامل" required value={v.fullName} onChange={(e) => set('fullName', e.target.value)} />
          {showPhone && <TextField label="رقم الهاتف" required dir="ltr" inputMode="tel" className="text-right" value={v.phone} onChange={(e) => set('phone', e.target.value)} hint="مثال: 0599123456" />}
          <SelectField label="الجنس" value={v.gender} onChange={(e) => set('gender', e.target.value as PatientFormValues['gender'])}>
            <option value="">غير محدد</option>
            <option value="MALE">ذكر</option>
            <option value="FEMALE">أنثى</option>
          </SelectField>
          <TextField label="تاريخ الميلاد" type="date" dir="ltr" max={todayInput()} className="text-right" value={v.birthDate} onChange={(e) => set('birthDate', e.target.value)} />
          <TextField label="رقم الهوية" dir="ltr" inputMode="numeric" className="text-right" value={v.nationalId} onChange={(e) => set('nationalId', e.target.value)} />
          <TextField label="المنطقة" value={v.region} onChange={(e) => set('region', e.target.value)} />
        </div>
        <TextField label="العنوان" value={v.address} onChange={(e) => set('address', e.target.value)} />
      </Card>
      <Card title="طبي" hint="يظهر التنبيه الطبي في قائمة المرضى بشارة حمراء حتى لا يُنسى.">
        <TextAreaField label="تنبيهات طبية" placeholder="مثال: حساسية من البنسلين، سكري" value={v.medicalAlerts} onChange={(e) => set('medicalAlerts', e.target.value)} />
        <TextAreaField label="ملاحظات" value={v.notes} onChange={(e) => set('notes', e.target.value)} />
      </Card>
    </>
  )
}
