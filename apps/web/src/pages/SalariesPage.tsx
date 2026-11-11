import { useState } from 'react'
import type { ReactNode } from 'react'
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
  afterAdvances,
  buildSalaryPayment,
  getSalaryMonth,
  isSalaryDue,
  monthNumber,
  salaryDueDate,
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

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'حدث خطأ غير متوقع، حاول مرة أخرى')
const METHODS = Object.keys(METHOD_LABELS) as PaymentMethod[]

/** Paying the month's salary. */
function PayModal({ entry, onClose, onDone }: { entry: SalaryEntry; onClose: () => void; onDone: () => void }) {
  return <PayForm title={`دفع راتب ${entry.user.fullName}`} kind="SALARY" entry={entry} onClose={onClose} onDone={onDone} />
}

function PayForm({ title, kind, entry, onClose, onDone, top }: { title: string; kind: PayKind; entry: SalaryEntry | null; onClose: () => void; onDone: () => void; top?: ReactNode }) {
  const [f, setF] = useState({ kind, amount: kind === 'SALARY' && entry ? String(entry.remaining / 100) : '', method: 'CASH' as PaymentMethod, day: todayInput(), note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    if (!entry) return setError('اختر الموظف')
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
    <Modal title={title} onClose={onClose}>
      {top}
      {entry && (
        <p className="text-sm text-muted">
          المتبقي من راتب شهر {monthNumber(entry.month)}: <Money agorot={entry.remaining} />
          {kind === 'ADVANCE' && ' · تُخصم السلفة من راتبه'}
        </p>
      )}
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

/** A new advance: pick the employee. It always comes off the coming salary, the current month's (due on the 25th). */
function AdvanceModal({ thisMonth, userId: startUser, onClose, onDone }: { thisMonth: string; userId?: string; onClose: () => void; onDone: () => void }) {
  const [userId, setUserId] = useState(startUser ?? '')
  const res = useLoad(() => getSalaryMonth(thisMonth), [thisMonth])
  const entries = res.data?.entries ?? []
  const entry = entries.find((e) => e.userId === userId) ?? entries[0] ?? null
  if (res.data && !entry) {
    return (
      <Modal title="سلفة جديدة" onClose={onClose}>
        <Alert tone="error">لا توجد رواتب لهذا الشهر. حدّد رواتب الموظفين أولاً.</Alert>
        <Button variant="secondary" onClick={onClose}>
          رجوع
        </Button>
      </Modal>
    )
  }
  const picker = (
    <SelectField label="الموظف" value={entry?.userId ?? ''} onChange={(e) => setUserId(e.target.value)}>
      {entries.map((e) => (
        <option key={e.id} value={e.userId}>
          {e.user.fullName} · {ROLE_LABELS[e.user.role]}
        </option>
      ))}
    </SelectField>
  )
  if (entry && entry.remaining === 0) {
    return (
      <Modal title="سلفة جديدة" onClose={onClose}>
        {picker}
        <div data-testid="advance-closed">
          <Alert tone="error">
            راتب شهر {monthNumber(entry.month)} لـ{entry.user.fullName} صُرف كاملاً، فلا يمكن تسجيل سلفة عليه. تُخصم السلفة من الراتب القادم.
          </Alert>
        </div>
        <Button variant="secondary" onClick={onClose}>
          رجوع
        </Button>
      </Modal>
    )
  }
  return (
    <PayForm
      key={entry?.id ?? 'none'}
      title="سلفة جديدة"
      kind="ADVANCE"
      entry={entry}
      onClose={onClose}
      onDone={onDone}
      top={
        <>
          {picker}
          {entry && (
            <p className="rounded-xl bg-page p-3 text-sm font-semibold" data-testid="advance-target">
              تُخصم من راتب شهر {monthNumber(entry.month)} (يستحق بتاريخ {salaryDueDate(entry.month)})
            </p>
          )}
        </>
      }
    />
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
    <Modal title={`تعديل راتب ${entry.user.fullName} لهذا الشهر`} onClose={onClose}>
      <p className="text-sm text-muted">
        الراتب الأساسي: <Money agorot={entry.baseAmount} />. التعديل لهذا الشهر فقط ولا يغيّر راتبه الأساسي.
      </p>
      <SelectField label="نوع التعديل" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as 'bonus' | 'deduction' })}>
        <option value="bonus">مكافأة (زيادة)</option>
        <option value="deduction">خصم</option>
      </SelectField>
      <TextField
        label="المبلغ (₪) — اتركه فارغاً لإلغاء التعديل"
        inputMode="decimal"
        dir="ltr"
        className="text-right"
        value={f.amount}
        onChange={(e) => setF({ ...f, amount: e.target.value })}
      />
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
        إلغاء <Money agorot={p.amount} />؟ تبقى ظاهرة في السجل كملغاة، ويعود المبلغ إلى المتبقي من الراتب.
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
            <Button
              size="sm"
              variant="secondary"
              className="mb-1.5"
              onClick={() => {
                setEditing(false)
                setError(null)
              }}
            >
              رجوع
            </Button>
          </span>
        ) : (
          <span className="flex items-center gap-3">
            {s.monthlySalary ? <Money agorot={s.monthlySalary} /> : <Badge label="لم يُحدَّد الراتب" bg="#fef0c7" fg="#93370d" />}
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

type Modal = { kind: 'pay'; entry: SalaryEntry } | { kind: 'advance'; userId?: string } | { kind: 'adjust'; entry: SalaryEntry } | { kind: 'void'; p: SalaryPaymentRow }

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
      <ClinicBanner title="الرواتب" subtitle="راتب كل موظف في كل شهر، والسلف، وكلها تُحتسب مع المصاريف والربح." />
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
          {data && (
            <div className="mt-4 flex justify-center border-t border-line pt-4">
              <Button variant="secondary" data-action="new-advance" onClick={() => setModal({ kind: 'advance' })}>
                + سلفة جديدة
              </Button>
            </div>
          )}
        </Card>

        {!data ? (
          <Loading error={error} />
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              {[
                ['رواتب الشهر', data.totals.net],
                ['المصروف (رواتب + سلف)', data.totals.paid],
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
                <p className="text-muted">لا توجد رواتب لهذا الشهر. حدّد رواتب الموظفين من القائمة أدناه وستظهر هنا تلقائياً.</p>
              </Card>
            ) : (
              data.entries.map((e) => (
                <Card key={e.id}>
                  <div className="flex flex-col gap-3" data-testid={`salary-${e.user.fullName}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="text-lg font-bold">
                        {e.user.fullName} <span className="text-sm font-normal text-muted">· {ROLE_LABELS[e.user.role]}</span>
                        {!e.user.isActive && (
                          <span className="ms-2">
                            <Badge label="موقوف" bg="#eceff3" fg="#4a5a70" />
                          </span>
                        )}
                      </span>
                      {e.remaining === 0 ? (
                        <Badge label={`تم صرف راتب شهر ${monthNumber(e.month)} ✓`} bg="#d1fadf" fg="#05603a" />
                      ) : isSalaryDue(e.month, todayInput()) ? (
                        <Badge label="حان موعد الصرف" bg="#fef0c7" fg="#93370d" />
                      ) : (
                        <Badge label={`يستحق بتاريخ ${salaryDueDate(e.month)}`} bg="#eceff3" fg="#4a5a70" />
                      )}
                    </div>
                    <p className="text-sm font-semibold" data-testid="salary-month">
                      راتب شهر {monthNumber(e.month)}
                    </p>
                    <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                      <div>
                        <dt className="text-muted">الراتب{e.adjustment !== 0 ? ' بعد التعديل' : ''}</dt>
                        <dd className="font-bold">
                          <Money agorot={e.net} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">سلف</dt>
                        <dd className="font-bold">
                          <Money agorot={e.advances} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">الراتب بعد السلف</dt>
                        <dd className="font-bold" data-testid="after-advances">
                          <Money agorot={afterAdvances(e)} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">دفعات راتب</dt>
                        <dd className="font-bold">
                          <Money agorot={e.salaryPaid} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">المتبقي</dt>
                        <dd className="font-bold" data-testid="remaining">
                          <Money agorot={e.remaining} />
                        </dd>
                      </div>
                    </dl>
                    {e.adjustment !== 0 && (
                      <p className="text-sm text-muted">
                        {e.adjustment > 0 ? 'مكافأة' : 'خصم'} <Money agorot={Math.abs(e.adjustment)} /> على الأساسي <Money agorot={e.baseAmount} />
                        {e.adjustNote ? ` · ${e.adjustNote}` : ''}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={e.remaining === 0 || !isSalaryDue(e.month, todayInput())} onClick={() => setModal({ kind: 'pay', entry: e })}>
                        دفع الراتب
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'advance', userId: e.userId })}>
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
                              {p.kind === 'ADVANCE' ? 'أخذ سلفة' : 'راتب'} <Money agorot={p.amount} /> · بتاريخ{' '}
                              <strong className="font-bold">
                                <DateText value={p.paidAt} />
                              </strong>{' '}
                              · {METHOD_LABELS[p.method]}
                              {p.kind === 'ADVANCE' && p.status === 'ACTIVE' ? ' · خُصمت من الراتب' : ''}
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

            <Card
              title="الرواتب الشهرية للموظفين"
              hint="الراتب الأساسي لكل موظف فعّال. يؤثر تغييره على الأشهر القادمة فقط، وتبقى الأشهر المفتوحة كما هي. يختفي الموظف الموقوف من الأشهر القادمة."
            >
              {data.staff.length === 0 ? (
                <p className="text-muted">لا يوجد موظفون (أطباء أو سكرتارية). أضفهم من صفحة الفريق.</p>
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
      {modal?.kind === 'pay' && <PayModal entry={modal.entry} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'advance' && <AdvanceModal thisMonth={thisMonth} {...(modal.userId ? { userId: modal.userId } : {})} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'adjust' && <AdjustModal entry={modal.entry} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'void' && <VoidModal p={modal.p} onClose={() => setModal(null)} onDone={done} />}
    </>
  )
}
