import { useState } from 'react'
import type { FormEvent } from 'react'
import { Badge, Card, DateText, Loading, Money } from '../../components/admin-ui.tsx'
import { Alert, Button, SelectField, TextField } from '../../components/ui.tsx'
import { addPayment, getBilling, voidPayment } from '../../lib/admin.ts'
import type { BillingStatus, Period } from '../../lib/admin.ts'
import { ApiError } from '../../lib/api.ts'
import { formatMoney, todayInput } from '../../lib/format.ts'
import { buildPaymentInput } from '../../lib/forms.ts'
import { useLoad } from '../../lib/useLoad.ts'

const BILLING_STYLE: Record<BillingStatus, { label: string; bg: string; fg: string }> = {
  NONE: { label: 'بدون فاتورة', bg: '#e8ecf1', fg: '#3d4b60' },
  UNPAID: { label: 'غير مدفوع', bg: '#fde8e8', fg: '#9b1c1c' },
  PARTIAL: { label: 'مدفوع جزئياً', bg: '#fff1d6', fg: '#7a4a00' },
  PAID: { label: 'مدفوع بالكامل', bg: '#e3f5ea', fg: '#0b6b3a' },
}

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'صار خطأ غير متوقع، جرب مرة ثانية')

function AddPayment({ clinicId, periods, onDone }: { clinicId: string; periods: Period[]; onDone: () => void }) {
  const open = periods.filter((p) => p.remaining > 0)
  const [periodId, setPeriodId] = useState(open[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [day, setDay] = useState(todayInput())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const current = open.find((p) => p.id === periodId) ?? open[0]

  if (!current) return <p className="text-sm text-muted">ما في مبلغ متبقي على أي فترة، لا يوجد دفعات جديدة لتسجيلها.</p>

  async function submit(e: FormEvent) {
    e.preventDefault()
    const r = buildPaymentInput({ amount, day, periodId: current!.id, note }, current!.remaining)
    if ('error' in r) return setError(r.error)
    setError(null)
    setBusy(true)
    try {
      await addPayment(clinicId, r.input)
      setAmount('')
      setNote('')
      onDone()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-xl bg-page p-4">
      <h3 className="font-bold">تسجيل دفعة جديدة</h3>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        {open.length > 1 && (
          <SelectField label="على أي فترة" value={current.id} onChange={(e) => setPeriodId(e.target.value)}>
            {open.map((p) => (
              <option key={p.id} value={p.id}>
                {p.months} شهر، من {new Date(p.startsAt).toLocaleDateString('en-CA')} (متبقي {formatMoney(p.remaining)})
              </option>
            ))}
          </SelectField>
        )}
        <TextField label="المبلغ (₪)" hint={`المتبقي على هذه الفترة: ${formatMoney(current.remaining)}`} inputMode="decimal" dir="ltr" className="text-right" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <TextField label="تاريخ الدفع" type="date" dir="ltr" max={todayInput()} className="text-right" value={day} onChange={(e) => setDay(e.target.value)} />
        <TextField label="ملاحظة (اختياري)" placeholder="مثال: تحويل بنكي" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <Button type="submit" size="sm" busy={busy} className="self-start">
        تسجيل الدفعة
      </Button>
    </form>
  )
}

function PaymentRow({ clinicId, p, onDone }: { clinicId: string; p: Period['payments'][number]; onDone: () => void }) {
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function confirm() {
    if (reason.trim().length < 2) return setError('اكتب سبب الإلغاء')
    setBusy(true)
    setError(null)
    try {
      await voidPayment(clinicId, p.id, reason.trim())
      onDone()
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-col gap-2 border-t border-[#e8eef6] py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={p.voided ? 'text-muted line-through' : 'font-semibold'}>
          <Money agorot={p.amount} /> · <DateText value={p.paidAt} />
          {p.note ? ` · ${p.note}` : ''}
        </span>
        {p.voided ? (
          <Badge label={`ملغاة: ${p.voidReason ?? ''}`} bg="#e8ecf1" fg="#3d4b60" />
        ) : (
          !asking && (
            <button type="button" className="cursor-pointer text-[#9b1c1c] underline" onClick={() => setAsking(true)}>
              إلغاء الدفعة
            </button>
          )
        )}
      </div>
      {asking && !p.voided && (
        <div className="flex flex-col gap-2 rounded-lg bg-[#fdf3f3] p-3">
          {error && <Alert tone="error">{error}</Alert>}
          <TextField label="سبب الإلغاء" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button type="button" variant="danger" size="sm" busy={busy} onClick={() => void confirm()}>
              تأكيد الإلغاء
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setAsking(false)}>
              رجوع
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

/** Terms, what was paid and what is left, and the payment log of one clinic. */
export function BillingSection({ clinicId, version, onChanged }: { clinicId: string; version: number; onChanged: () => void }) {
  const { data, error, reload } = useLoad(() => getBilling(clinicId), [clinicId, version])
  const changed = () => {
    reload()
    onChanged()
  }
  if (!data) return <Loading error={error} />

  return (
    <Card title="الاشتراك والدفعات" hint="المبلغ المتبقي ما بيقفل العيادة، بس انتهاء المدة. الدفعات ما بتنحذف، بتنلغى بسبب وبتضل بالسجل.">
      {data.periods.length === 0 ? (
        <p className="text-sm text-muted">ما في فترات اشتراك مسجّلة بسعر لهذه العيادة.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            {[
              ['إجمالي المطلوب', data.totalPrice, '#152437'],
              ['المدفوع', data.totalPaid, '#0b6b3a'],
              ['المتبقي', data.totalRemaining, data.totalRemaining > 0 ? '#9b1c1c' : '#0b6b3a'],
            ].map(([label, value, color]) => (
              <div key={label as string} className="flex flex-1 basis-36 flex-col gap-1 rounded-xl bg-page p-4">
                <span className="text-[13px] text-muted">{label as string}</span>
                <span style={{ color: color as string }} className="text-2xl font-bold">
                  <Money agorot={value as number} />
                </span>
              </div>
            ))}
          </div>
          <AddPayment key={data.periods.map((p) => p.id + p.remaining).join()} clinicId={clinicId} periods={data.periods} onDone={changed} />
          {data.periods.map((p) => (
            <div key={p.id} className="flex flex-col rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="font-bold">
                    {p.months} شهر · <DateText value={p.startsAt} /> ← <DateText value={p.endsAt} />
                  </span>
                  <span className="text-sm text-[#33445b]">
                    السعر <Money agorot={p.price} /> · مدفوع <Money agorot={p.paid} /> · متبقي <Money agorot={p.remaining} />
                  </span>
                </div>
                <Badge {...BILLING_STYLE[p.status]} />
              </div>
              {p.payments.length > 0 && (
                <ul className="mt-3">
                  {p.payments.map((x) => (
                    <PaymentRow key={x.id} clinicId={clinicId} p={x} onDone={changed} />
                  ))}
                </ul>
              )}
            </div>
          ))}
        </>
      )}
    </Card>
  )
}
