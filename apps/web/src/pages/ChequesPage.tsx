import { useState } from 'react'
import { Link, Navigate } from 'react-router'
import { useAuth } from '../auth/AuthContext.tsx'
import { Card, DateText, Loading, Money } from '../components/admin-ui.tsx'
import { ClinicBanner } from '../components/clinic-ui.tsx'
import { ChequeModal, DueNote, StatusBadge } from '../components/cheque-ui.tsx'
import { canSeeMoney } from '../lib/access.ts'
import { chequeQuery, DIRECTION_LABELS, FILTER_LABELS, listCheques, missingOf } from '../lib/cheques.ts'
import type { ChequeFilter, DirectionFilter } from '../lib/cheques.ts'
import { toLatinDigits } from '../lib/format.ts'
import { useLoad } from '../lib/useLoad.ts'

const FILTERS = Object.keys(FILTER_LABELS) as ChequeFilter[]
const DIRECTIONS = Object.keys(DIRECTION_LABELS) as DirectionFilter[]

function Box({ label, amount, count, tone, testId }: { label: string; amount?: number; count: number; tone?: 'warn' | 'bad'; testId: string }) {
  const color = tone === 'bad' ? 'text-[#9b1c1c]' : tone === 'warn' ? 'text-[#7a5200]' : ''
  return (
    <div className="flex flex-1 basis-40 flex-col gap-1 rounded-2xl border border-line bg-white p-5" data-testid={testId}>
      <span className="text-sm text-muted">{label}</span>
      <span className={`text-2xl font-bold ${color}`}>{amount === undefined ? count : <Money agorot={amount} />}</span>
      {amount !== undefined && <span className="text-xs text-muted">{count} شك</span>}
    </div>
  )
}

/** The cheques box: what is still in hand, what was cashed, what came back. Same people as payments. */
export default function ChequesPage() {
  const { session } = useAuth()
  const [direction, setDirection] = useState<DirectionFilter>('ALL')
  const [filter, setFilter] = useState<ChequeFilter>('ALL')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const query = chequeQuery(direction, filter, q)
  const { data, error, reload } = useLoad(() => listCheques(query), [query])
  if (session && !canSeeMoney(session.user)) return <Navigate to="/home" replace />
  const t = data?.totals

  return (
    <>
      <ClinicBanner title="الشكات" subtitle={session?.user.role === 'DOCTOR' ? 'شكات مرضاك على علاجاتك أنت.' : 'كل شكات العيادة: لم تُصرف، مصروفة، ومرتجعة.'} />
      <div className="flex max-w-5xl flex-col gap-5">
        {!t || !data ? (
          <Loading error={error} />
        ) : (
          <>
            {data.outgoing && <h2 className="text-lg font-bold">الواردة (شكات المرضى)</h2>}
            <div className="flex flex-wrap gap-3">
              <Box label="لم تُصرف بعد" amount={t.pending.amount} count={t.pending.count} testId="cheques-pending" />
              <Box label="موعد صرفها اليوم" amount={t.dueToday.amount} count={t.dueToday.count} tone={t.dueToday.count > 0 ? 'warn' : undefined} testId="cheques-today" />
              <Box label="فات موعدها ولم تُصرف" amount={t.overdue.amount} count={t.overdue.count} tone={t.overdue.count > 0 ? 'bad' : undefined} testId="cheques-overdue" />
              <Box label="مصروفة" amount={t.cashed.amount} count={t.cashed.count} testId="cheques-cashed" />
              <Box label="مرتجعة" amount={t.returned.amount} count={t.returned.count} tone={t.returned.count > 0 ? 'bad' : undefined} testId="cheques-returned" />
              <Box label="محوّلة لصادر (دفعنا بها مصروفاً)" amount={t.endorsed.amount} count={t.endorsed.count} testId="cheques-endorsed" />
              <Box label="ناقصة البيانات" count={t.incomplete} tone={t.incomplete > 0 ? 'bad' : undefined} testId="cheques-incomplete" />
            </div>
            {data.outgoing && (
              <>
                <h2 className="text-lg font-bold">الصادرة (كتبناها لدفع المصاريف)</h2>
                <div className="flex flex-wrap gap-3">
                  <Box label="صادرة لم تُصرف بعد" amount={data.outgoing.pending.amount} count={data.outgoing.pending.count} testId="out-pending" />
                  <Box label="موعد صرفها اليوم" amount={data.outgoing.dueToday.amount} count={data.outgoing.dueToday.count} tone={data.outgoing.dueToday.count > 0 ? 'warn' : undefined} testId="out-today" />
                  <Box label="فات موعدها ولم تُصرف" amount={data.outgoing.overdue.amount} count={data.outgoing.overdue.count} tone={data.outgoing.overdue.count > 0 ? 'bad' : undefined} testId="out-overdue" />
                  <Box label="صادرة مصروفة" amount={data.outgoing.cashed.amount} count={data.outgoing.cashed.count} testId="out-cashed" />
                  <Box label="واردة محوّلة لصادر" amount={t.endorsed.amount} count={t.endorsed.count} testId="out-endorsed" />
                  <Box
                    label="إجمالي الصادر (مكتوبة + محوّلة)"
                    amount={data.outgoing.pending.amount + data.outgoing.cashed.amount + t.endorsed.amount}
                    count={data.outgoing.pending.count + data.outgoing.cashed.count + t.endorsed.count}
                    testId="out-total"
                  />
                </div>
              </>
            )}
            <Card title="قائمة الشكات" hint="الشك الوارد يُحسب من دخل العيادة (الكاش) يوم صرفه فقط. قبل ذلك ينقص من المتبقي على المريض، ويظهر هنا. والشك الصادر يُحسب مصروفاً يوم كتابته.">
              {data.outgoing && (
                <div role="tablist" aria-label="اتجاه الشك" className="flex flex-wrap gap-2">
                  {DIRECTIONS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      role="tab"
                      aria-selected={direction === d}
                      onClick={() => setDirection(d)}
                      className={`h-10 cursor-pointer rounded-lg border px-4 text-sm font-bold ${direction === d ? 'border-brand-dark bg-brand-dark text-on-brand' : 'border-line bg-white'}`}
                    >
                      {DIRECTION_LABELS[d]}
                    </button>
                  ))}
                </div>
              )}
              <div role="tablist" aria-label="تصفية الشكات" className="flex flex-wrap gap-2">
                {FILTERS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={filter === f}
                    onClick={() => setFilter(f)}
                    className={`h-10 cursor-pointer rounded-full border px-4 text-sm font-semibold ${filter === f ? 'border-brand bg-brand text-on-brand' : 'border-line bg-white'}`}
                  >
                    {FILTER_LABELS[f]}
                  </button>
                ))}
              </div>
              <input type="search" aria-label="بحث" placeholder="ابحث باسم المريض أو المورّد أو صاحب الشك أو رقم الشك أو البنك" value={q} onChange={(e) => setQ(toLatinDigits(e.target.value))} className="h-11 rounded-xl border border-line bg-white px-3" />
              {data.items.length === 0 ? (
                <p className="text-muted">لا توجد شكات هنا.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line" aria-label="الشكات">
                  {data.items.map((c) => (
                    <li key={c.id} data-testid="cheque-row" data-status={c.status} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-2">
                          {c.direction === 'OUTGOING' ? (
                            <span className="font-semibold">{c.bill?.supplier?.name ?? c.bill?.category ?? 'مصروف'}</span>
                          ) : c.patient ? (
                            <Link to={`/patients/${c.patient.id}`} className="font-semibold underline">
                              {c.patient.fullName}
                            </Link>
                          ) : (
                            <span className="font-semibold">—</span>
                          )}
                          <StatusBadge c={c} />
                          <DueNote c={c} />
                          {c.direction === 'INCOMING' && c.status === 'ENDORSED' && c.bill && (
                            <span className="text-sm font-semibold text-[#2a4a9b]">دفعنا به: {c.bill.supplier?.name ?? c.bill.category}</span>
                          )}
                        </span>
                        <span className="text-sm text-muted">
                          {c.dueDate ? (
                            <>
                              يُصرف <DateText value={c.dueDate} />
                            </>
                          ) : (
                            'بدون تاريخ صرف'
                          )}
                          {c.chequeNumber ? ` · رقم ${c.chequeNumber}` : ''}
                          {c.bankName ? ` · ${c.bankName}` : ''}
                          {c.drawerName ? ` · ${c.drawerName}` : ''}
                        </span>
                        {c.incomplete && <span className="text-sm font-bold text-[#9b1c1c]">{missingOf(c)}</span>}
                      </span>
                      <span className="flex items-center gap-3">
                        <strong className="text-lg">{c.amount === null ? '—' : <Money agorot={c.amount} />}</strong>
                        <button type="button" onClick={() => setOpen(c.id)} className="h-9 cursor-pointer rounded-lg border border-line bg-white px-3 text-sm font-semibold">
                          فتح
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
      {open && <ChequeModal id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  )
}
