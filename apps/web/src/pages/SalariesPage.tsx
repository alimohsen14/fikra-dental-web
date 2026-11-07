import { useState } from 'react'
import { Badge, Card, DateText, Loading, Money } from '../components/admin-ui.tsx'
import { ClinicBanner } from '../components/clinic-ui.tsx'
import { Modal } from '../components/Modal.tsx'
import { Alert, Button, SelectField, TextAreaField, TextField } from '../components/ui.tsx'
import { ApiError } from '../lib/api.ts'
import { ROLE_LABELS } from '../auth/paths.ts'
import { todayInput } from '../lib/format.ts'
import {
  adjustEntry,
  adjustmentForm,
  buildAdjustment,
  buildMonthlySalary,
  buildSalaryPayment,
  getSalaryMonth,
  monthName,
  monthOf,
  paySalary,
  setMonthlySalary,
  shiftMonth,
  voidSalaryPayment,
} from '../lib/salaries.ts'
import type { PayKind, SalaryEntry, SalaryPaymentRow, StaffSalary } from '../lib/salaries.ts'
import { METHOD_LABELS } from '../lib/treatments.ts'
import type { PaymentMethod } from '../lib/treatments.ts'
import { useLoad } from '../lib/useLoad.ts'

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'صار خطأ غير متوقع، جرب مرة ثانية')
const METHODS = Object.keys(METHOD_LABELS) as PaymentMethod[]

function PayModal({ entry, kind, onClose, onDone }: { entry: SalaryEntry; kind: PayKind; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ kind, amount: kind === 'SALARY' ? String(entry.remaining / 100) : '', method: 'CASH' as PaymentMethod, day: todayInput(), note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    const r = buildSalaryPayment(f, entry.remaining)
    if ('error' in r) return setError(r.error)
    setBusy(true)
    setError(null)
    try {
      await paySalary(entry.id, r.body)
      onDone()
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }
  return (
    <Modal title={kind === 'SALARY' ? `دفع راتب ${entry.user.fullName}` : `سلفة لـ ${entry.user.fullName}`} onClose={onClose}>
      <p className="text-sm text-muted">
        المتبقي من راتب الشهر: <Money agorot={entry.remaining} />
        {kind === 'ADVANCE' && ' · السلفة بتنخصم من راتب نفس الشهر'}
      </p>
      <TextField label="المبلغ (₪)" inputMode="decimal" dir="ltr" className="text-right" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
      <SelectField label="طريقة الدفع" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PaymentMethod })}>
        {METHODS.map((m) => (
          <option key={m} value={m}>
            {METHOD_LABELS[m]}
          </option>
        ))}
      </SelectField>
      <TextField label="التاريخ" type="date" max={todayInput()} value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} />
      <TextAreaField label="ملاحظة (اختياري)" value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap gap-3">
        <Button busy={busy} onClick={() => void submit()}>
          تسجيل
        </Button>
        <Button variant="secondary" onClick={onClose}>
          رجوع
        </Button>
      </div>
    </Modal>
  )
}

function AdjustModal({ entry, onClose, onDone }: { entry: SalaryEntry; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState(adjustmentForm(entry.adjustment, entry.adjustNote))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    const r = buildAdjustment(f, entry.baseAmount, entry.paid)
    if ('error' in r) return setError(r.error)
    setBusy(true)
    setError(null)
    try {
      await adjustEntry(entry.id, r.body)
      onDone()
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }
  return (
    <Modal title={`تعديل راتب ${entry.user.fullName} لهالشهر`} onClose={onClose}>
      <p className="text-sm text-muted">
        الراتب الأساسي: <Money agorot={entry.baseAmount} />. التعديل لهالشهر بس، وما بغيّر راتبه الأساسي.
      </p>
      <SelectField label="نوع التعديل" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as 'bonus' | 'deduction' })}>
        <option value="bonus">مكافأة (زيادة)</option>
        <option value="deduction">خصم</option>
      </SelectField>
      <TextField label="المبلغ (₪) — فاضي لإلغاء التعديل" inputMode="decimal" dir="ltr" className="text-right" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
      <TextAreaField label="السبب (اختياري)" value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap gap-3">
        <Button busy={busy} onClick={() => void submit()}>
          حفظ
        </Button>
        <Button variant="secondary" onClick={onClose}>
          رجوع
        </Button>
      </div>
    </Modal>
  )
}

function VoidModal({ p, onClose, onDone }: { p: SalaryPaymentRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    if (reason.trim().length < 2) return setError('اكتب سبب الإلغاء')
    setBusy(true)
    setError(null)
    try {
      await voidSalaryPayment(p.id, reason.trim())
      onDone()
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }
  return (
    <Modal title={p.kind === 'ADVANCE' ? 'إلغاء السلفة' : 'إلغاء دفعة الراتب'} onClose={onClose}>
      <p className="text-[15px]">
        إلغاء <Money agorot={p.amount} />؟ بتضل ظاهرة بالسجل كملغية، والمبلغ بيرجع للمتبقي من الراتب.
      </p>
      <TextAreaField label="سبب الإلغاء" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap gap-3">
        <Button variant="danger" busy={busy} onClick={() => void submit()}>
          تأكيد الإلغاء
        </Button>
        <Button variant="secondary" onClick={onClose}>
          رجوع
        </Button>
      </div>
    </Modal>
  )
}

function StaffSalaryRow({ s, onSaved }: { s: StaffSalary; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(s.monthlySalary ? String(s.monthlySalary / 100) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save() {
    const r = buildMonthlySalary(value)
    if ('error' in r) return setError(r.error)
    setBusy(true)
    setError(null)
    try {
      await setMonthlySalary(s.id, r.amount)
      setEditing(false)
      onSaved()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className="flex flex-col gap-2 py-3" data-testid={`staff-${s.fullName}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-semibold">
          {s.fullName} <span className="font-normal text-muted">· {ROLE_LABELS[s.role]}</span>
        </span>
        {editing ? (
          <span className="flex items-end gap-2">
            <TextField label="الراتب الشهري (₪)" inputMode="decimal" dir="ltr" className="text-right" value={value} onChange={(e) => setValue(e.target.value)} />
            <Button size="sm" busy={busy} className="mb-1.5" onClick={() => void save()}>
              حفظ
            </Button>
            <Button size="sm" variant="secondary" className="mb-1.5" onClick={() => { setEditing(false); setError(null) }}>
              رجوع
            </Button>
          </span>
        ) : (
          <span className="flex items-center gap-3">
            {s.monthlySalary ? <Money agorot={s.monthlySalary} /> : <Badge label="ما انحدد راتب" bg="#fef0c7" fg="#93370d" />}
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              {s.monthlySalary ? 'تعديل الراتب' : 'تحديد الراتب'}
            </Button>
          </span>
        )}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </li>
  )
}

type Modal = { kind: 'pay'; entry: SalaryEntry; pay: PayKind } | { kind: 'adjust'; entry: SalaryEntry } | { kind: 'void'; p: SalaryPaymentRow }

export default function SalariesPage() {
  const thisMonth = monthOf(todayInput())
  const [month, setMonth] = useState(thisMonth)
  const [modal, setModal] = useState<Modal | null>(null)
  const { data, error, reload } = useLoad(() => getSalaryMonth(month), [month])
  const done = () => {
    setModal(null)
    reload()
  }

  return (
    <>
      <ClinicBanner title="الرواتب" subtitle="راتب كل موظف كل شهر، والسلف، وكلها بتنحسب مع المصاريف والربح." />
      <div className="flex max-w-4xl flex-col gap-5">
        <Card>
          <div className="flex items-center justify-center gap-2">
            <Button size="sm" variant="secondary" aria-label="الشهر السابق" onClick={() => setMonth(shiftMonth(month, -1))}>
              →
            </Button>
            <strong data-testid="month-title" className="min-w-44 text-center">
              {monthName(month)}
            </strong>
            <Button size="sm" variant="secondary" aria-label="الشهر التالي" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))}>
              ←
            </Button>
          </div>
        </Card>

        {!data ? (
          <Loading error={error} />
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              {[
                ['رواتب الشهر', data.totals.net],
                ['اللي انعطى (رواتب + سلف)', data.totals.paid],
                ['المتبقي', data.totals.remaining],
              ].map(([label, v]) => (
                <div key={label as string} className="flex flex-1 basis-40 flex-col gap-1 rounded-2xl border border-line bg-white p-5">
                  <span className="text-sm text-muted">{label}</span>
                  <span className="text-2xl font-bold" data-testid={`total-${label}`}>
                    <Money agorot={v as number} />
                  </span>
                </div>
              ))}
            </div>

            {data.entries.length === 0 ? (
              <Card>
                <p className="text-muted">ما في رواتب لهالشهر. حدد راتب الموظفين من القائمة تحت وبتطلع هون تلقائي.</p>
              </Card>
            ) : (
              data.entries.map((e) => (
                <Card key={e.id}>
                  <div className="flex flex-col gap-3" data-testid={`salary-${e.user.fullName}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="text-lg font-bold">
                        {e.user.fullName} <span className="text-sm font-normal text-muted">· {ROLE_LABELS[e.user.role]}</span>
                        {!e.user.isActive && <span className="ms-2"><Badge label="موقوف" bg="#eceff3" fg="#4a5a70" /></span>}
                      </span>
                      {e.remaining === 0 ? <Badge label="مكتمل" bg="#d1fadf" fg="#05603a" /> : <Badge label="باقي" bg="#fef0c7" fg="#93370d" />}
                    </div>
                    <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                      <div>
                        <dt className="text-muted">الراتب{e.adjustment !== 0 ? ' بعد التعديل' : ''}</dt>
                        <dd className="font-bold"><Money agorot={e.net} /></dd>
                      </div>
                      <div>
                        <dt className="text-muted">سلف</dt>
                        <dd className="font-bold"><Money agorot={e.advances} /></dd>
                      </div>
                      <div>
                        <dt className="text-muted">دفعات راتب</dt>
                        <dd className="font-bold"><Money agorot={e.salaryPaid} /></dd>
                      </div>
                      <div>
                        <dt className="text-muted">المتبقي</dt>
                        <dd className="font-bold" data-testid="remaining"><Money agorot={e.remaining} /></dd>
                      </div>
                    </dl>
                    {e.adjustment !== 0 && (
                      <p className="text-sm text-muted">
                        {e.adjustment > 0 ? 'مكافأة' : 'خصم'} <Money agorot={Math.abs(e.adjustment)} /> على الأساسي <Money agorot={e.baseAmount} />
                        {e.adjustNote ? ` · ${e.adjustNote}` : ''}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={e.remaining === 0} onClick={() => setModal({ kind: 'pay', entry: e, pay: 'SALARY' })}>
                        دفع الراتب
                      </Button>
                      <Button size="sm" variant="secondary" disabled={e.remaining === 0} onClick={() => setModal({ kind: 'pay', entry: e, pay: 'ADVANCE' })}>
                        سلفة
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'adjust', entry: e })}>
                        مكافأة / خصم
                      </Button>
                    </div>
                    {e.payments.length > 0 && (
                      <ul className="flex flex-col gap-1 border-s-2 border-line ps-3 text-sm">
                        {e.payments.map((p) => (
                          <li key={p.id} className="flex flex-wrap items-center gap-2">
                            <span className={p.status === 'VOIDED' ? 'text-muted line-through' : ''}>
                              {p.kind === 'ADVANCE' ? 'سلفة' : 'راتب'} <Money agorot={p.amount} /> · {METHOD_LABELS[p.method]} · <DateText value={p.paidAt} />
                              {p.note ? ` · ${p.note}` : ''}
                            </span>
                            {p.status === 'VOIDED' ? (
                              <span className="text-muted">(ملغية: {p.voidReason})</span>
                            ) : (
                              <button type="button" className="cursor-pointer text-[#b42318] underline" onClick={() => setModal({ kind: 'void', p })}>
                                إلغاء
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>
              ))
            )}

            <Card title="الرواتب الشهرية للموظفين" hint="الراتب الأساسي لكل موظف فعّال. تغييره بيأثر على الشهور الجاي بس، والشهور اللي انفتحت بتضل زي ما هي. الموظف الموقوف بيختفي من الشهور الجاي.">
              {data.staff.length === 0 ? (
                <p className="text-muted">ما في موظفين (دكاترة أو سكرتارية). ضيفهم من صفحة الفريق.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {data.staff.map((s) => (
                    <StaffSalaryRow key={s.id + String(s.monthlySalary)} s={s} onSaved={reload} />
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
      {modal?.kind === 'pay' && <PayModal entry={modal.entry} kind={modal.pay} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'adjust' && <AdjustModal entry={modal.entry} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'void' && <VoidModal p={modal.p} onClose={() => setModal(null)} onDone={done} />}
    </>
  )
}
