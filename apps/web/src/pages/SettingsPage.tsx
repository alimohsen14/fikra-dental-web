import { useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Card, ColorPicker } from '../components/admin-ui.tsx'
import { ClinicBanner } from '../components/clinic-ui.tsx'
import { Alert, Button, TextField } from '../components/ui.tsx'
import { useAuth } from '../auth/AuthContext.tsx'
import { ApiError, assetUrl } from '../lib/api.ts'
import { flashState } from '../lib/flash.ts'
import { checkLogoFile, removeClinicLogo, saveClinicSettings, uploadClinicLogo } from '../lib/clinicSettings.ts'

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'حدث خطأ غير متوقع، حاول مرة أخرى')

export default function SettingsPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const clinic = session!.clinic!
  const [name, setName] = useState(clinic.name)
  const [color, setColor] = useState<string | null>(clinic.themeColor)
  const [identity, setIdentity] = useState<{ error?: string; ok?: boolean; busy?: boolean }>({})
  const [logo, setLogo] = useState<{ error?: string; ok?: string; busy?: boolean }>({})
  const fileInput = useRef<HTMLInputElement>(null)
  const dirty = name.trim() !== clinic.name || color !== clinic.themeColor

  async function saveIdentity(e: FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2) return setIdentity({ error: 'اكتب اسم العيادة' })
    setIdentity({ busy: true })
    try {
      await saveClinicSettings({
        ...(name.trim() !== clinic.name ? { name: name.trim() } : {}),
        ...(color !== clinic.themeColor ? { themeColor: color } : {}),
      })
      navigate('/home', { state: flashState('تم حفظ إعدادات العيادة.') })
    } catch (err) {
      setIdentity({ error: messageOf(err) })
    }
  }

  async function pickLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // lets the same file be picked again later
    if (!file) return
    const problem = checkLogoFile(file)
    if (problem) return setLogo({ error: problem })
    setLogo({ busy: true })
    try {
      await uploadClinicLogo(file)
      setLogo({ ok: 'تم رفع الشعار.' })
    } catch (err) {
      setLogo({ error: messageOf(err) })
    }
  }

  async function deleteLogo() {
    setLogo({ busy: true })
    try {
      await removeClinicLogo()
      setLogo({ ok: 'تم حذف الشعار.' })
    } catch (err) {
      setLogo({ error: messageOf(err) })
    }
  }

  return (
    <>
      <ClinicBanner title="الإعدادات" subtitle="هوية عيادتك: الاسم واللون والشعار، وتظهر لجميع موظفي العيادة." />
      <div className="flex max-w-3xl flex-col gap-5">
        <Card title="الشعار" hint="PNG أو JPG أو WebP، حتى 512 كيلوبايت. الأفضل صورة مربعة بخلفية شفافة أو بيضاء.">
          <div className="flex flex-wrap items-center gap-5">
            {clinic.logoUrl ? (
              <img src={assetUrl(clinic.logoUrl)} alt={`شعار ${clinic.name}`} className="size-24 rounded-2xl border border-line bg-white object-contain p-1" />
            ) : (
              <span className="inline-flex size-24 items-center justify-center rounded-2xl bg-brand text-4xl font-bold text-on-brand">{clinic.name.charAt(0)}</span>
            )}
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" busy={logo.busy} onClick={() => fileInput.current?.click()}>
                  {clinic.logoUrl ? 'تغيير الشعار' : 'رفع شعار'}
                </Button>
                {clinic.logoUrl && (
                  <Button type="button" size="sm" variant="secondary" disabled={logo.busy} onClick={() => void deleteLogo()}>
                    حذف الشعار
                  </Button>
                )}
              </div>
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="اختيار ملف الشعار" onChange={(e) => void pickLogo(e)} />
            </div>
          </div>
          {logo.error && <Alert tone="error">{logo.error}</Alert>}
          {logo.ok && <Alert tone="success">{logo.ok}</Alert>}
        </Card>

        <Card title="الاسم واللون" hint="يظهر اللون في الشريط الجانبي والأزرار والعناوين لجميع الموظفين.">
          <form onSubmit={saveIdentity} noValidate className="flex flex-col gap-4">
            {identity.error && <Alert tone="error">{identity.error}</Alert>}
            {identity.ok && <Alert tone="success">تم الحفظ.</Alert>}
            <TextField label="اسم العيادة" value={name} onChange={(e) => setName(e.target.value)} />
            <ColorPicker value={color} onChange={setColor} />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="sm" busy={identity.busy} disabled={!dirty}>
                حفظ
              </Button>
              {color && (
                <button type="button" className="cursor-pointer text-sm text-brand-dark underline" onClick={() => setColor(null)}>
                  رجوع للون الافتراضي
                </button>
              )}
            </div>
          </form>
        </Card>
      </div>
    </>
  )
}
