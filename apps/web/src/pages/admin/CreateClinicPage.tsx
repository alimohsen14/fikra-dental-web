import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { Card, PageBanner, SecretBox } from '../../components/admin-ui.tsx'
import { Alert, Button, SelectField, TextField } from '../../components/ui.tsx'
import { createClinic } from '../../lib/admin.ts'
import type { TempCredentials } from '../../lib/admin.ts'
import { ApiError } from '../../lib/api.ts'
import { buildCreateInput } from '../../lib/forms.ts'

const MONTHS = [
  [1, 'شهر واحد'],
  [3, '3 أشهر'],
  [6, '6 أشهر'],
  [12, '12 شهر'],
  [24, '24 شهر'],
] as const

export default function CreateClinicPage() {
  const [f, setF] = useState({ name: '', ownerName: '', username: '', phone: '', specialty: '', months: 12, price: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<(TempCredentials & { clinic: { id: string; name: string } }) | null>(null)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const r = buildCreateInput(f)
    if ('error' in r) return setError(r.error)
    setError(null)
    setBusy(true)
    try {
      setDone(await createClinic(r.input))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'صار خطأ غير متوقع، جرب مرة ثانية')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageBanner title="عيادة جديدة" subtitle="بتنشئ العيادة وحساب المالك، والمالك بيصير دكتور بالنظام تلقائياً." back={{ to: '/admin', label: 'رجوع للعيادات' }} />
      {done ? (
        <div className="flex max-w-xl flex-col gap-4">
          <Alert tone="success">تم إنشاء عيادة «{done.clinic.name}».</Alert>
          <SecretBox title="بيانات دخول المالك" username={done.owner.username} password={done.temporaryPassword} expiresAt={done.temporaryPasswordExpiresAt} />
          <div className="flex flex-wrap gap-3">
            <Link to={`/admin/clinics/${done.clinic.id}`} className="inline-flex h-12 items-center rounded-xl bg-brand px-6 font-semibold text-on-brand">
              فتح صفحة العيادة
            </Link>
            <Link to="/admin" className="inline-flex h-12 items-center rounded-xl border border-line bg-white px-6 font-semibold">
              رجوع للعيادات
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex max-w-3xl flex-col gap-5" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <Card title="بيانات العيادة">
            <TextField label="اسم العيادة" required value={f.name} onChange={(e) => set('name', e.target.value)} />
            <p className="text-[13px] text-muted">اللون واللوغو بيختارهم مالك العيادة من إعدادات العيادة.</p>
          </Card>
          <Card title="حساب المالك">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="اسم المالك" required value={f.ownerName} onChange={(e) => set('ownerName', e.target.value)} />
              <TextField label="اسم المستخدم" dir="ltr" required autoCapitalize="none" spellCheck={false} className="text-right" value={f.username} onChange={(e) => set('username', e.target.value)} />
              <TextField label="رقم الجوال (اختياري)" dir="ltr" className="text-right" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
              <TextField label="التخصص (اختياري)" value={f.specialty} onChange={(e) => set('specialty', e.target.value)} />
            </div>
          </Card>
          <Card title="الاشتراك" hint="بيبدأ الاشتراك من اليوم وبينتهي بعد المدة. الدفعات بتسجلها لاحقاً من صفحة العيادة، والمبلغ المتبقي ما بيقفل العيادة، بس انتهاء المدة.">
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label="المدة" value={f.months} onChange={(e) => set('months', Number(e.target.value))}>
                {MONTHS.map(([m, label]) => (
                  <option key={m} value={m}>
                    {label}
                  </option>
                ))}
              </SelectField>
              <TextField label="السعر الكلي (₪)" inputMode="decimal" dir="ltr" required className="text-right" value={f.price} onChange={(e) => set('price', e.target.value)} />
            </div>
          </Card>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" busy={busy}>
              إنشاء العيادة
            </Button>
            <Link to="/admin" className="inline-flex h-13 items-center rounded-xl border border-line bg-white px-6 font-semibold">
              إلغاء
            </Link>
          </div>
        </form>
      )}
    </>
  )
}
