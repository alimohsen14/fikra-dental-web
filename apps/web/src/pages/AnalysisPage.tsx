import { useState } from 'react'
import { Card, Loading, Money } from '../components/admin-ui.tsx'
import { ClinicBanner } from '../components/clinic-ui.tsx'
import { Button } from '../components/ui.tsx'
import { averageProfit, bestMonth, layoutBars, shortShekels } from '../lib/analysis.ts'
import { listYearMonths, monthsForTable, profitChange } from '../lib/expenses.ts'
import type { MonthRow } from '../lib/expenses.ts'
import { monthName } from '../lib/salaries.ts'
import { todayInput } from '../lib/format.ts'
import { useLoad } from '../lib/useLoad.ts'

const GOOD = '#067647'
const BAD = '#b42318'

function Tile({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex flex-1 basis-44 flex-col gap-1 rounded-2xl border border-line bg-white p-5">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-xl font-bold" data-testid={testId}>
        {children}
      </span>
    </div>
  )
}

/** Profit for every month on one zero line. Tap, hover or focus a column to read its numbers; the best month is starred. */
function ProfitChart({ rows, best }: { rows: MonthRow[]; best: MonthRow | null }) {
  const [picked, setPicked] = useState<string | null>(null)
  const { bars, ticks } = layoutBars(rows)
  const shownMonth = picked ?? best?.month ?? (rows.filter((r) => r.month <= todayInput().slice(0, 7)).pop() ?? rows[0])?.month
  const current = rows.find((r) => r.month === shownMonth) ?? rows[0]
  return (
    <div className="flex flex-col gap-4">
      {current && (
        <div className="rounded-xl bg-page p-4 text-sm" data-testid="chart-detail" aria-live="polite">
          <strong className="text-base">{monthName(current.month)}</strong>
          <span className="mx-2 text-muted">·</span>
          الدخل <Money agorot={current.income} /> · مصاريف <Money agorot={current.expensesPaid} /> · رواتب وسلف <Money agorot={current.salariesPaid} /> ·{' '}
          <strong style={{ color: current.profit >= 0 ? GOOD : BAD }}>
            الربح <Money agorot={current.profit} />
          </strong>
        </div>
      )}
      <div className="overflow-x-auto">
        <div className="min-w-[52rem]">
          <div dir="ltr" className="relative mt-12 mb-10 h-72 ps-14" role="img" aria-label="الربح لكل شهر">
            {ticks.map((t) => (
              <div key={t.value} className="absolute inset-x-0" style={{ top: `${t.topPct}%` }} aria-hidden>
                <span className="absolute start-0 -translate-y-1/2 pe-2 text-[11px] text-muted">
                  {shortShekels(t.value)}
                </span>
                <div className={`ms-14 border-t ${t.value === 0 ? 'border-[#8a97a8]' : 'border-dashed border-line'}`} />
              </div>
            ))}
            <div className="absolute inset-y-0 end-0 start-14 flex">
              {bars.map((b, i) => {
                const isBest = best?.month === b.month
                const selected = shownMonth === b.month
                const row = rows[i]!
                return (
                  <button
                    key={b.month}
                    type="button"
                    data-testid={`bar-${b.month}`}
                    aria-label={`${monthName(b.month)}: الربح ${b.profit / 100} شيكل`}
                    onClick={() => setPicked(b.month)}
                    onMouseEnter={() => setPicked(b.month)}
                    onFocus={() => setPicked(b.month)}
                    className={`relative flex-1 cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand ${selected ? 'bg-page/70' : ''}`}
                  >
                    {b.heightPct > 0 && (
                      <span
                        className="absolute left-1/2 w-[min(60%,26px)] -translate-x-1/2"
                        style={{
                          top: `${b.topPct}%`,
                          height: `${Math.max(b.heightPct, 0.8)}%`,
                          background: b.profit >= 0 ? GOOD : BAD,
                          borderRadius: b.profit >= 0 ? '4px 4px 0 0' : '0 0 4px 4px',
                          opacity: isBest || selected ? 1 : 0.85,
                        }}
                      />
                    )}
                    {b.profit !== 0 && (
                      <bdi
                        className="absolute inset-x-0 text-center text-[11px] font-semibold"
                        style={{ top: b.profit > 0 ? `calc(${b.topPct}% - ${isBest ? 36 : 18}px)` : `calc(${b.topPct + b.heightPct}% + 3px)`, color: b.profit > 0 ? GOOD : BAD }}
                      >
                        {isBest && <span className="block text-[11px]">★ الأفضل</span>}
                        {shortShekels(row.profit)}
                      </bdi>
                    )}
                    <span className="absolute inset-x-0 top-full mt-4 text-center text-sm font-semibold text-muted" aria-hidden>
                      {Number(b.month.slice(5))}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AnalysisPage() {
  const thisYear = Number(todayInput().slice(0, 4))
  const thisMonth = todayInput().slice(0, 7)
  const [year, setYear] = useState(thisYear)
  const { data, error } = useLoad(() => listYearMonths(year), [year])
  // the table: months that have come, newest first, without the empty ones before the first activity
  const shown = data ? monthsForTable(data.filter((r) => r.month <= thisMonth)) : null
  const oldestFirst = shown ? [...shown].reverse() : null
  const allMonths = data ?? []
  const best = bestMonth(allMonths)

  return (
    <>
      <ClinicBanner title="تحليل" subtitle="ماذا حدث في الأشهر الأخيرة: الدخل والمصاريف والربح، وأي شهر كان الأفضل." />
      <div className="flex max-w-4xl flex-col gap-5">
        {!shown || !oldestFirst ? (
          <Loading error={error} />
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              <Tile label={`أفضل شهر في ${year}`} testId="best-month">
                {best ? (
                  <>
                    {monthName(best.month)} · <Money agorot={best.profit} />
                  </>
                ) : (
                  <span className="text-muted">لا يوجد شهر فيه ربح بعد</span>
                )}
              </Tile>
              <Tile label="متوسط الربح الشهري" testId="avg-profit">
                <Money agorot={averageProfit(oldestFirst)} />
              </Tile>
            </div>

            <Card>
              <div className="flex items-center justify-center gap-2">
                <Button size="sm" variant="secondary" aria-label="السنة السابقة" onClick={() => setYear(year - 1)}>
                  →
                </Button>
                <strong data-testid="year-title" className="min-w-24 text-center text-lg">
                  {year}
                </strong>
                <Button size="sm" variant="secondary" aria-label="السنة التالية" disabled={year >= thisYear} onClick={() => setYear(year + 1)}>
                  ←
                </Button>
              </div>
            </Card>

            <Card title="الربح كل شهر" hint="أشهر السنة كلها، من 1 (كانون الثاني) إلى 12 (كانون الأول). الربح = ما قبضناه من المرضى − ما دفعناه (مصاريف + رواتب وسلف). الأخضر ربح والأحمر خسارة. مرّر أو اضغط على أي شهر لترى أرقامه.">
              <ProfitChart key={year} rows={allMonths} best={best} />
            </Card>

            <Card title="مقارنة الأشهر" hint="أشهر هذه السنة جنباً إلى جنب، من أول نشاط حتى اليوم.">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm" data-testid="months-table">
                  <thead>
                    <tr className="border-b border-line text-muted">
                      {['الشهر', 'الدخل', 'مصاريف', 'رواتب وسلف', 'الربح', 'مقارنة بالشهر السابق'].map((h) => (
                        <th key={h} className="py-2 text-start font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => {
                      const change = profitChange(oldestFirst, r.month)
                      return (
                        <tr key={r.month} className="border-b border-line last:border-0" data-testid={`month-${r.month}`}>
                          <td className="py-2 font-semibold">{monthName(r.month)}</td>
                          <td className="py-2"><Money agorot={r.income} /></td>
                          <td className="py-2"><Money agorot={r.expensesPaid} /></td>
                          <td className="py-2"><Money agorot={r.salariesPaid} /></td>
                          <td className="py-2 font-bold" style={{ color: r.profit >= 0 ? GOOD : BAD }}><Money agorot={r.profit} /></td>
                          <td className="py-2 text-muted">
                            {change === null ? '-' : change === 0 ? 'دون تغيير' : (
                              <span style={{ color: change > 0 ? GOOD : BAD }}>
                                {change > 0 ? '▲' : '▼'} <Money agorot={Math.abs(change)} />
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </>
  )
}
