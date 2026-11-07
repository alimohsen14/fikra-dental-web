import { useState } from 'react'
import { Badge, Card, DateText, Loading, Money } from '../components/admin-ui.tsx'
import { ClinicBanner } from '../components/clinic-ui.tsx'
import { Modal } from '../components/Modal.tsx'
import { Alert, Button, SelectField, TextAreaField, TextField } from '../components/ui.tsx'
import { ApiError } from '../lib/api.ts'
import {
  addDefaultCategories,
  buildExpenseBody,
  buildExpensePayment,
  createCategory,
  createExpense,
  createSupplier,
  getSummary,
  isCurrent,
  listCategories,
  listExpenses,
  listSuppliers,
  payExpense,
  PERIOD_LABELS,
  periodTitle,
  shiftDate,
  voidExpense,
  voidExpensePayment,
} from '../lib/expenses.ts'
import type { Category, Expense, ExpensePaymentRow, Period, Supplier } from '../lib/expenses.ts'
import { todayInput } from '../lib/format.ts'
import { METHOD_LABELS } from '../lib/treatments.ts'
import type { PaymentMethod } from '../lib/treatments.ts'
import { useLoad } from '../lib/useLoad.ts'

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'صار خطأ غير متوقع، جرب مرة ثانية')
const METHODS = Object.keys(METHOD_LABELS) as PaymentMethod[]

function MethodSelect({ value, onChange }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void }) {
  return (
    <SelectField label="طريقة الدفع" value={value} onChange={(e) => onChange(e.target.value as PaymentMethod)}>
      {METHODS.map((m) => (
        <option key={m} value={m}>
          {METHOD_LABELS[m]}
        </option>
      ))}
    </SelectField>
  )
}

/** Small "add" row used for a new type or a new supplier inside the expense dialog. */
function QuickAdd({ label, onAdd }: { label: string; onAdd: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  if (!open)
    return (
      <button type="button" className="cursor-pointer self-start text-sm font-semibold text-brand underline" onClick={() => setOpen(true)}>
        + {label}
      </button>
    )
  async function add() {
    if (name.trim().length < 2) return setError('الاسم لازم حرفين على الأقل')
    try {
      await onAdd(name.trim())
      setName('')
      setOpen(false)
      setError(null)
    } catch (e) {
      setError(messageOf(e))
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <TextField label={label} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button size="sm" className="mb-1.5" onClick={() => void add()}>
          إضافة
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  )
}

function ExpenseModal({ categories, suppliers, onClose, onDone, reloadLists }: { categories: Category[]; suppliers: Supplier[]; onClose: () => void; onDone: () => void; reloadLists: () => void }) {
  const [f, setF] = useState({ categoryId: '', supplierId: '', description: '', amount: '', day: todayInput(), paid: 'full' as 'full' | 'none' | 'part', paidAmount: '', method: 'CASH' as PaymentMethod })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    const r = buildExpenseBody(f)
    if ('error' in r) return setError(r.error)
    setBusy(true)
    setError(null)
    try {
      await createExpense(r.body)
      onDone()
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }
  return (
    <Modal title="مصروف جديد" onClose={onClose}>
      <SelectField label="النوع" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
        <option value="">اختر...</option>
        {categories.filter((c) => c.isActive).map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <QuickAdd label="نوع جديد" onAdd={async (name) => { const c = await createCategory(name); reloadLists(); setF((x) => ({ ...x, categoryId: c.id })) }} />
      <SelectField label="اشتريت من / الجهة (اختياري)" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
        <option value="">بدون</option>
        {suppliers.filter((s) => s.isActive).map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </SelectField>
      <QuickAdd label="جهة جديدة (محل، مختبر، موظف...)" onAdd={async (name) => { const s = await createSupplier({ name }); reloadLists(); setF((x) => ({ ...x, supplierId: s.id })) }} />
      <TextField label="المبلغ الكامل (₪)" inputMode="decimal" dir="ltr" className="text-right" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
      <TextField label="التاريخ" type="date" max={todayInput()} value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} />
      <SelectField label="الدفع" value={f.paid} onChange={(e) => setF({ ...f, paid: e.target.value as 'full' | 'none' | 'part' })}>
        <option value="full">مدفوع كامل</option>
        <option value="part">مدفوع جزء والباقي علينا</option>
        <option value="none">ما اندفع شي (علينا كامل)</option>
      </SelectField>
      {f.paid === 'part' && <TextField label="المدفوع (₪)" inputMode="decimal" dir="ltr" className="text-right" value={f.paidAmount} onChange={(e) => setF({ ...f, paidAmount: e.target.value })} />}
      {f.paid !== 'none' && <MethodSelect value={f.method} onChange={(method) => setF({ ...f, method })} />}
      <TextAreaField label="ملاحظة (اختياري)" value={f.description} maxLength={500} onChange={(e) => setF({ ...f, description: e.target.value })} />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap gap-3">
        <Button busy={busy} onClick={() => void submit()}>
          حفظ المصروف
        </Button>
        <Button variant="secondary" onClick={onClose}>
          رجوع
        </Button>
      </div>
    </Modal>
  )
}

function PayModal({ e, onClose, onDone }: { e: Expense; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ amount: '', method: 'CASH' as PaymentMethod, day: todayInput(), note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    const r = buildExpensePayment(f, e.remaining)
    if ('error' in r) return setError(r.error)
    setBusy(true)
    setError(null)
    try {
      await payExpense(e.id, r.body)
      onDone()
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }
  return (
    <Modal title="دفعة للمصروف" onClose={onClose}>
      <p className="text-sm text-muted">
        {e.supplier?.name ?? e.category.name} · المتبقي: <Money agorot={e.remaining} />
      </p>
      <TextField label="المبلغ (₪)" inputMode="decimal" dir="ltr" className="text-right" value={f.amount} onChange={(x) => setF({ ...f, amount: x.target.value })} />
      <MethodSelect value={f.method} onChange={(method) => setF({ ...f, method })} />
      <TextField label="تاريخ الدفعة" type="date" max={todayInput()} value={f.day} onChange={(x) => setF({ ...f, day: x.target.value })} />
      <TextAreaField label="ملاحظة (اختياري)" value={f.note} maxLength={300} onChange={(x) => setF({ ...f, note: x.target.value })} />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap gap-3">
        <Button busy={busy} onClick={() => void submit()}>
          تسجيل الدفعة
        </Button>
        <Button variant="secondary" onClick={onClose}>
          رجوع
        </Button>
      </div>
    </Modal>
  )
}

type VoidTarget = { kind: 'expense'; e: Expense } | { kind: 'payment'; p: ExpensePaymentRow }

function VoidModal({ target, onClose, onDone }: { target: VoidTarget; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    if (reason.trim().length < 2) return setError('اكتب سبب الإلغاء')
    setBusy(true)
    setError(null)
    try {
      if (target.kind === 'expense') await voidExpense(target.e.id, reason.trim())
      else await voidExpensePayment(target.p.id, reason.trim())
      onDone()
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }
  return (
    <Modal title={target.kind === 'expense' ? 'إلغاء المصروف' : 'إلغاء الدفعة'} onClose={onClose}>
      <p className="text-[15px]">
        {target.kind === 'expense' ? 'إلغاء المصروف مع كل دفعاته؟ ' : 'إلغاء هذه الدفعة؟ المبلغ بيرجع علينا. '}
        بيضل ظاهر بالسجل كملغي.
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

function Stat({ label, children, tone }: { label: string; children: React.ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="flex flex-1 basis-40 flex-col gap-1 rounded-2xl border border-line bg-white p-5">
      <span className="text-sm text-muted">{label}</span>
      <span className={`text-2xl font-bold ${tone === 'good' ? 'text-[#067647]' : tone === 'bad' ? 'text-[#b42318]' : ''}`}>{children}</span>
    </div>
  )
}

function ExpenseRow({ e, onPay, onVoid }: { e: Expense; onPay: () => void; onVoid: (t: VoidTarget) => void }) {
  const voided = e.status === 'VOIDED'
  return (
    <li className="flex flex-col gap-2 py-3" data-testid={`expense-${e.description ?? e.category.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={`flex flex-col ${voided ? 'text-muted line-through' : ''}`}>
          <span className="font-semibold">
            {e.category.name}
            {e.supplier && <span className="font-normal text-muted"> · {e.supplier.name}</span>}
          </span>
          {e.description && <span className="text-sm text-muted">{e.description}</span>}
          <span className="text-sm text-muted">
            <DateText value={e.incurredAt} />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <strong>
            <Money agorot={e.amount} />
          </strong>
          {voided ? <Badge label="ملغي" bg="#eceff3" fg="#4a5a70" /> : e.remaining > 0 ? <Badge label={`علينا ${Math.round(e.remaining / 100)}₪`} bg="#fef0c7" fg="#93370d" /> : <Badge label="مدفوع" bg="#d1fadf" fg="#05603a" />}
          {!voided && e.remaining > 0 && (
            <Button size="sm" variant="secondary" onClick={onPay}>
              دفع
            </Button>
          )}
          {!voided && (
            <Button size="sm" variant="secondary" onClick={() => onVoid({ kind: 'expense', e })}>
              إلغاء
            </Button>
          )}
        </div>
      </div>
      {voided && e.voidReason && <p className="text-sm text-muted">سبب الإلغاء: {e.voidReason}</p>}
      {e.payments.length > 0 && (
        <ul className="flex flex-col gap-1 border-s-2 border-line ps-3 text-sm">
          {e.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2">
              <span className={p.status === 'VOIDED' ? 'text-muted line-through' : ''}>
                <Money agorot={p.amount} /> · {METHOD_LABELS[p.method]} · <DateText value={p.paidAt} />
                {p.note ? ` · ${p.note}` : ''}
              </span>
              {p.status === 'VOIDED' ? (
                <span className="text-muted">(ملغية: {p.voidReason})</span>
              ) : (
                !voided && (
                  <button type="button" className="cursor-pointer text-[#b42318] underline" onClick={() => onVoid({ kind: 'payment', p })}>
                    إلغاء الدفعة
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export default function ExpensesPage() {
  const [period, setPeriod] = useState<Period>('day')
  const [date, setDate] = useState(todayInput())
  const [supplierId, setSupplierId] = useState<string | null>(null)
  const [modal, setModal] = useState<'new' | { pay: Expense } | { void: VoidTarget } | null>(null)

  const summary = useLoad(() => getSummary(period, date), [period, date])
  const cats = useLoad(listCategories, [])
  const sups = useLoad(listSuppliers, [])
  const s = summary.data
  const list = useLoad(
    () => (supplierId ? listExpenses({ supplierId, unpaid: true }) : s ? listExpenses({ from: s.from, to: s.to }) : Promise.resolve([] as Expense[])),
    [supplierId, s?.from, s?.to],
  )

  function reloadAll() {
    setModal(null)
    summary.reload()
    sups.reload()
    list.reload()
  }
  function reloadLists() {
    cats.reload()
    sups.reload()
  }
  const [seeding, setSeeding] = useState(false)

  const filteredSupplier = supplierId ? sups.data?.suppliers.find((x) => x.id === supplierId) : null

  return (
    <>
      <ClinicBanner
        title="المصاريف"
        subtitle="رواتب، كهربا، مي، مشتريات... وكمان شو علينا لكل جهة."
        action={
          <Button variant="secondary" onClick={() => setModal('new')}>
            + مصروف جديد
          </Button>
        }
      />
      <div className="flex max-w-4xl flex-col gap-5">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2" role="tablist">
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <Button key={p} size="sm" role="tab" aria-selected={p === period} variant={p === period ? 'primary' : 'secondary'} onClick={() => { setPeriod(p); setSupplierId(null) }}>
                  {PERIOD_LABELS[p]}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" aria-label="السابق" onClick={() => { setDate(shiftDate(date, period, -1)); setSupplierId(null) }}>
                →
              </Button>
              <strong data-testid="period-title" className="min-w-40 text-center">
                {s ? periodTitle(s) : '...'}
              </strong>
              <Button size="sm" variant="secondary" aria-label="التالي" disabled={!s || isCurrent(s, todayInput())} onClick={() => { setDate(shiftDate(date, period, 1)); setSupplierId(null) }}>
                ←
              </Button>
            </div>
          </div>
        </Card>

        {!s ? (
          <Loading error={summary.error} />
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              <Stat label={`الدخل (${s.incomeCount} دفعة من المرضى)`}>
                <Money agorot={s.income} />
              </Stat>
              <Stat label="المصاريف المدفوعة">
                <Money agorot={s.expensesPaid} />
              </Stat>
              <Stat label="الربح" tone={s.profit >= 0 ? 'good' : 'bad'}>
                <span data-testid="profit">
                  <Money agorot={s.profit} />
                </span>
              </Stat>
            </div>
            <p className="text-sm text-muted">الربح = اللي قبضناه من المرضى − اللي دفعناه فعلاً. اللي لسا ما اندفع بيظهر تحت "علينا" وما بينخصم إلا لما ينصرف.</p>
            {s.byCategory.length > 0 && (
              <Card title="حسب النوع">
                <ul className="flex flex-col divide-y divide-line">
                  {s.byCategory.map((c) => (
                    <li key={c.categoryId} className="flex flex-wrap justify-between gap-3 py-2">
                      <span className="font-semibold">{c.name}</span>
                      <span className="text-sm">
                        مصروف <Money agorot={c.incurred} /> · مدفوع <Money agorot={c.paid} />
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}

        <Card title="علينا للموردين" hint="كل جهة وكم بدها منا">
          {!sups.data ? (
            <Loading error={sups.error} />
          ) : sups.data.owedTotal === 0 ? (
            <p className="text-muted">ما علينا شي. 👍</p>
          ) : (
            <>
              <p className="text-lg">
                المجموع: <strong data-testid="owed-total"><Money agorot={sups.data.owedTotal} /></strong>
              </p>
              <ul className="flex flex-col divide-y divide-line">
                {sups.data.suppliers.filter((x) => x.owed > 0).map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 py-2" data-testid={`owed-${x.name}`}>
                    <span className="font-semibold">{x.name}</span>
                    <span className="flex items-center gap-3">
                      <Money agorot={x.owed} />
                      <Button size="sm" variant="secondary" onClick={() => setSupplierId(x.id)}>
                        فواتيره
                      </Button>
                    </span>
                  </li>
                ))}
                {sups.data.owedUnassigned > 0 && (
                  <li className="flex justify-between gap-3 py-2">
                    <span className="text-muted">بدون جهة</span>
                    <Money agorot={sups.data.owedUnassigned} />
                  </li>
                )}
              </ul>
            </>
          )}
        </Card>

        <Card title={filteredSupplier ? `فواتير غير مدفوعة: ${filteredSupplier.name}` : s ? (period === 'day' ? 'مصاريف اليوم' : 'المصاريف في هالفترة') : 'المصاريف'}>
          {filteredSupplier && (
            <Button size="sm" variant="secondary" className="self-start" onClick={() => setSupplierId(null)}>
              رجوع لعرض الفترة
            </Button>
          )}
          {!list.data ? (
            <Loading error={list.error} />
          ) : list.data.length === 0 ? (
            <p className="text-muted">ما في مصاريف.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {list.data.map((e) => (
                <ExpenseRow key={e.id} e={e} onPay={() => setModal({ pay: e })} onVoid={(t) => setModal({ void: t })} />
              ))}
            </ul>
          )}
        </Card>

        {cats.data && cats.data.length === 0 && (
          <Card title="لسا ما في أنواع مصاريف" hint="ضيف القائمة الجاهزة (رواتب، كهربا، مي...) وبتقدر تضيف أنواع غيرها وقت ما بدك.">
            <Button
              variant="secondary"
              size="sm"
              busy={seeding}
              className="self-start"
              onClick={() => {
                setSeeding(true)
                void addDefaultCategories().finally(() => { setSeeding(false); cats.reload() })
              }}
            >
              إضافة القائمة الجاهزة
            </Button>
          </Card>
        )}
      </div>

      {modal === 'new' && cats.data && sups.data && <ExpenseModal categories={cats.data} suppliers={sups.data.suppliers} onClose={() => setModal(null)} onDone={reloadAll} reloadLists={reloadLists} />}
      {modal && typeof modal === 'object' && 'pay' in modal && <PayModal e={modal.pay} onClose={() => setModal(null)} onDone={reloadAll} />}
      {modal && typeof modal === 'object' && 'void' in modal && <VoidModal target={modal.void} onClose={() => setModal(null)} onDone={reloadAll} />}
    </>
  )
}
