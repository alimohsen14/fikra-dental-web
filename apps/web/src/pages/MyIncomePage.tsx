import { useState } from 'react'
import { Link } from 'react-router'
import { Card, DateText, Loading, Money } from '../components/admin-ui.tsx'
import { ClinicBanner } from '../components/clinic-ui.tsx'
import { Button } from '../components/ui.tsx'
import { isCurrent, PERIOD_LABELS, periodTitle, shiftDate } from '../lib/expenses.ts'
import type { Period } from '../lib/expenses.ts'
import { todayInput } from '../lib/format.ts'
import { getMyIncome, getMyMonths, yearSummary } from '../lib/myIncome.ts'
import { METHOD_LABELS } from '../lib/treatments.ts'
import { useLoad } from '../lib/useLoad.ts'

export default function MyIncomePage() {
  const [period, setPeriod] = useState<Period>('month')
  const [date, setDate] = useState(todayInput())
  const income = useLoad(() => getMyIncome(period, date), [period, date])
  const year = Number(date.slice(0, 4))
  const months = useLoad(() => getMyMonths(year), [year])
  const d = income.data
  const ys = months.data ? yearSummary(months.data) : null

  return (
    <>
      <ClinicBanner title="دخلي" subtitle="اللي دفعه المرضى على علاجاتك أنت بس. ما حدا غيرك بيشوفه، ولا حتى المالك." />
      <div className="flex max-w-4xl flex-col gap-5">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2" role="tablist">
              {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                <Button key={p} size="sm" role="tab" aria-selected={p === period} variant={p === period ? 'primary' : 'secondary'} onClick={() => setPeriod(p)}>
                  {PERIOD_LABELS[p]}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" aria-label="السابق" onClick={() => setDate(shiftDate(date, period, -1))}>
                →
              </Button>
              <strong data-testid="period-title" className="min-w-40 text-center">
                {d ? periodTitle(d) : '...'}
              </strong>
              <Button size="sm" variant="secondary" aria-label="التالي" disabled={!d || isCurrent(d, todayInput())} onClick={() => setDate(shiftDate(date, period, 1))}>
                ←
              </Button>
            </div>
          </div>
        </Card>

        {!d ? (
          <Loading error={income.error} />
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-1 basis-44 flex-col gap-1 rounded-2xl border border-line bg-white p-5">
                <span className="text-sm text-muted">دخلي بهالفترة</span>
                <span className="text-2xl font-bold" data-testid="my-income">
                  <Money agorot={d.income} />
                </span>
              </div>
              <div className="flex flex-1 basis-44 flex-col gap-1 rounded-2xl border border-line bg-white p-5">
                <span className="text-sm text-muted">عدد الدفعات</span>
                <span className="text-2xl font-bold" data-testid="my-count">
                  {d.count}
                </span>
              </div>
            </div>
            <Card title="الدفعات">
              {d.payments.length === 0 ? (
                <p className="text-muted">ما في دفعات بهالفترة.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {d.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="my-payment">
                      <span className="flex flex-col">
                        <Link to={`/patients/${p.patient.id}`} className="font-semibold underline">
                          {p.patient.fullName}
                        </Link>
                        <span className="text-sm text-muted">
                          <DateText value={p.paidAt} /> · {METHOD_LABELS[p.method]}
                        </span>
                      </span>
                      <strong>
                        <Money agorot={p.amount} />
                      </strong>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}

        <Card title={`شهور ${year}`} hint={ys?.best ? `أفضل شهر: ${Number(ys.best.month.slice(5))}` : undefined}>
          {!months.data || !ys ? (
            <Loading error={months.error} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[20rem] text-sm" data-testid="my-months">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th className="py-2 text-start font-semibold">الشهر</th>
                    <th className="py-2 text-start font-semibold">دخلي</th>
                  </tr>
                </thead>
                <tbody>
                  {months.data.map((m) => (
                    <tr key={m.month} className="border-b border-line" data-testid={`my-month-${m.month}`}>
                      <td className="py-2 font-semibold">{Number(m.month.slice(5))}</td>
                      <td className="py-2">
                        <Money agorot={m.income} />
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2 font-bold">المجموع</td>
                    <td className="py-2 font-bold" data-testid="my-year-total">
                      <Money agorot={ys.total} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
