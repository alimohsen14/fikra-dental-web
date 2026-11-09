import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useParams } from 'react-router'
import { Badge, Card, DateText, Loading, PageBanner, SecretBox, StateBadge } from '../../components/admin-ui.tsx'
import { Alert, Button, SelectField, TextField } from '../../components/ui.tsx'
import { getClinic, renewClinic, resetOwnerPassword, setClinicActive, updateClinic } from '../../lib/admin.ts'
import type { ClinicDetail, TempCredentials } from '../../lib/admin.ts'
import { ApiError } from '../../lib/api.ts'
import { endOfDayIso, parseShekels, todayInput } from '../../lib/format.ts'
import { useLoad } from '../../lib/useLoad.ts'
import { ROLE_LABELS } from '../../auth/paths.ts'
import { BillingSection } from './BillingSection.tsx'
import { WhatsappCard } from './WhatsappCard.tsx'

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'صار خطأ غير متوقع، جرب مرة ثانية')

/** Small helper: runs an action, shows its error, and calls `then` when it worked. */
function useAction() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function run(fn: () => Promise<unknown>, then?: () => void) {
    setError(null)
    setBusy(true)
    try {
      await fn()
      then?.()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }
  return { error, setError, busy, run }
}

function StatusCard({ clinic, onChanged }: { clinic: ClinicDetail; onChanged: () => void }) {
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const { error, busy, run } = useAction()
  const suspended = clinic.status === 'SUSPENDED'
  return (
    <Card title={suspended ? 'العيادة موقوفة' : 'إيقاف العيادة'} hint={suspended ? 'ما حدا من موظفيها بيقدر يدخل لحد ما تفعّلها.' : 'الإيقاف بيمنع كل موظفي العيادة من الدخول فوراً، والبيانات بتضل محفوظة.'}>
      {error && <Alert tone="error">{error}</Alert>}
      {suspended ? (
        <Button size="sm" className="self-start" busy={busy} onClick={() => void run(() => setClinicActive(clinic.id, true), onChanged)}>
          تفعيل العيادة
        </Button>
      ) : asking ? (
        <div className="flex flex-col gap-3">
          <TextField label="سبب الإيقاف (اختياري)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              busy={busy}
              onClick={() =>
                void run(
                  () => setClinicActive(clinic.id, false, reason.trim() || undefined),
                  () => {
                    setAsking(false)
                    setReason('')
                    onChanged()
                  },
                )
              }
            >
              تأكيد الإيقاف
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setAsking(false)}>
              رجوع
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="danger" size="sm" className="self-start" onClick={() => setAsking(true)}>
          إيقاف العيادة
        </Button>
      )}
    </Card>
  )
}

const RENEW_MONTHS = [1, 3, 6, 12, 24]

function RenewCard({ clinic, onChanged }: { clinic: ClinicDetail; onChanged: () => void }) {
  const [mode, setMode] = useState<'months' | 'date'>('months')
  const [months, setMonths] = useState(12)
  const [date, setDate] = useState('')
  const [price, setPrice] = useState('')
  const { error, setError, busy, run } = useAction()
  const [ok, setOk] = useState(false)

  function submit(e: FormEvent) {
    e.preventDefault()
    setOk(false)
    const agorot = price.trim() ? parseShekels(price) : undefined
    if (agorot === null) return setError('اكتب السعر كرقم، مثال: 3000')
    if (mode === 'date' && (!date || new Date(endOfDayIso(date)).getTime() <= Date.now())) return setError('اختار تاريخ انتهاء بالمستقبل')
    const price_ = agorot === undefined ? {} : { price: agorot }
    const body = mode === 'months' ? { months, ...price_ } : { endsAt: endOfDayIso(date), ...price_ }
    void run(() => renewClinic(clinic.id, body), () => {
      setOk(true)
      setPrice('')
      onChanged()
    })
  }

  return (
    <Card id="renew" title="تجديد الاشتراك" hint="لما تستلم الدفعة جدد من هون. إذا تركت السعر فاضي بيكون تمديد مجاني بدون فاتورة. التمديد بالأشهر بيبدأ من تاريخ الانتهاء الحالي، أو من اليوم إذا كان انتهى.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}
        {ok && <Alert tone="success">تم تجديد الاشتراك.</Alert>}
        <div role="radiogroup" aria-label="طريقة التجديد" className="flex gap-4 text-sm font-semibold">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" name="renewMode" checked={mode === 'months'} onChange={() => setMode('months')} /> بالأشهر
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" name="renewMode" checked={mode === 'date'} onChange={() => setMode('date')} /> لتاريخ محدد
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {mode === 'months' ? (
            <SelectField label="المدة" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              {RENEW_MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m === 1 ? 'شهر واحد' : `${m} ${m <= 10 ? 'أشهر' : 'شهر'}`}
                </option>
              ))}
            </SelectField>
          ) : (
            <TextField label="ينتهي بتاريخ" type="date" dir="ltr" min={todayInput()} className="text-right" value={date} onChange={(e) => setDate(e.target.value)} />
          )}
          <TextField label="سعر هالفترة (₪) - اختياري" inputMode="decimal" dir="ltr" className="text-right" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <Button type="submit" size="sm" busy={busy} className="self-start">
          تجديد الاشتراك
        </Button>
      </form>
    </Card>
  )
}

function IdentityCard({ clinic, onChanged }: { clinic: ClinicDetail; onChanged: () => void }) {
  const [name, setName] = useState(clinic.name)
  const { error, setError, busy, run } = useAction()
  const [ok, setOk] = useState(false)
  const dirty = name.trim() !== clinic.name

  function submit(e: FormEvent) {
    e.preventDefault()
    setOk(false)
    if (name.trim().length < 2) return setError('اكتب اسم العيادة')
    void run(
      () => updateClinic(clinic.id, { name: name.trim() }),
      () => {
        setOk(true)
        onChanged()
      },
    )
  }

  return (
    <Card title="هوية العيادة" hint="اللون واللوغو من إعدادات العيادة نفسها، المالك بس بيغيّرهم.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}
        {ok && <Alert tone="success">تم الحفظ.</Alert>}
        <TextField label="اسم العيادة" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" busy={busy} disabled={!dirty}>
            حفظ
          </Button>
        </div>
      </form>
    </Card>
  )
}

function UsersCard({ clinic }: { clinic: ClinicDetail }) {
  const [asking, setAsking] = useState(false)
  const [creds, setCreds] = useState<TempCredentials | null>(null)
  const { error, busy, run } = useAction()
  const [now] = useState(() => Date.now())
  return (
    <Card title="المستخدمون" hint={`${clinic.users.length} مستخدم، و ${clinic.patientsCount} مريض.`}>
      <ul>
        {clinic.users.map((u) => (
          <li key={u.id} className="flex flex-col gap-1.5 border-t border-[#e8eef6] py-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-semibold">{u.fullName}</span>
              <span className="text-muted">{ROLE_LABELS[u.role]}</span>
            </div>
            <bdi dir="ltr" className="self-start text-[13px] text-[#33445b]">
              {u.username}
            </bdi>
            <span className="flex flex-wrap gap-1.5 empty:hidden">
              {!u.isActive && <Badge label="معطّل" bg="#e8ecf1" fg="#3d4b60" />}
              {u.mustChangePassword && <Badge label="كلمة مؤقتة" bg="#fff1d6" fg="#7a4a00" />}
              {u.lockedUntil && new Date(u.lockedUntil).getTime() > now && <Badge label="مقفول مؤقتاً" bg="#fde8e8" fg="#9b1c1c" />}
            </span>
          </li>
        ))}
      </ul>
      {error && <Alert tone="error">{error}</Alert>}
      {creds ? (
        <SecretBox title="كلمة مرور جديدة للمالك" username={creds.owner.username} password={creds.temporaryPassword} expiresAt={creds.temporaryPasswordExpiresAt} />
      ) : asking ? (
        <div className="flex flex-col gap-3 rounded-xl bg-[#fdf3f3] p-4">
          <p className="text-sm leading-7">بتنعمل كلمة مؤقتة جديدة للمالك، وبيتسجّل خروجه من كل الأجهزة. تكمل؟</p>
          <div className="flex gap-2">
            <Button variant="danger" size="sm" busy={busy} onClick={() => void run(async () => setCreds(await resetOwnerPassword(clinic.id)), () => setAsking(false))}>
              نعم، أعد التعيين
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setAsking(false)}>
              رجوع
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" className="self-start" onClick={() => setAsking(true)}>
          إعادة تعيين كلمة مرور المالك
        </Button>
      )}
    </Card>
  )
}

export default function ClinicPage() {
  const { id = '' } = useParams()
  const { hash } = useLocation()
  const [billingVersion, setBillingVersion] = useState(0)
  const { data: clinic, error, reload } = useLoad(() => getClinic(id), [id])

  // The "renew" shortcut on the clinics list links to #renew.
  useEffect(() => {
    if (clinic && hash === '#renew') document.getElementById('renew')?.scrollIntoView()
  }, [clinic, hash])

  if (!clinic) return <Loading error={error} />
  const refresh = () => {
    reload()
    setBillingVersion((v) => v + 1)
  }

  return (
    <>
      <PageBanner
        title={clinic.name}
        back={{ to: '/admin', label: 'رجوع للعيادات' }}
        subtitle={clinic.subscriptionEndsAt ? undefined : 'بدون تاريخ انتهاء'}
        action={
          <div className="flex flex-col items-start gap-2 rounded-xl bg-white/95 px-4 py-3 text-ink">
            <StateBadge state={clinic.state} />
            {clinic.subscriptionEndsAt && (
              <span className="text-sm">
                ينتهي الاشتراك: <DateText value={clinic.subscriptionEndsAt} />
              </span>
            )}
          </div>
        }
      />
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[3_1_460px] flex-col gap-5">
          <RenewCard clinic={clinic} onChanged={refresh} />
          <BillingSection clinicId={clinic.id} version={billingVersion} onChanged={reload} />
        </div>
        <div className="flex min-w-0 flex-[2_1_320px] flex-col gap-5">
          <IdentityCard key={clinic.name} clinic={clinic} onChanged={reload} />
          <WhatsappCard clinicId={clinic.id} />
          <StatusCard clinic={clinic} onChanged={reload} />
          <UsersCard clinic={clinic} />
        </div>
      </div>
    </>
  )
}
