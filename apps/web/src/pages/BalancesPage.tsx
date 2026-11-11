import { useState } from 'react'
import { Link, Navigate } from 'react-router'
import { useAuth } from '../auth/AuthContext.tsx'
import { Card, DateText, Loading, Money } from '../components/admin-ui.tsx'
import { ClinicBanner } from '../components/clinic-ui.tsx'
import { canSeeMoney } from '../lib/access.ts'
import { filterBalances, getBalances } from '../lib/balances.ts'
import { useLoad } from '../lib/useLoad.ts'

export default function BalancesPage() {
  const { session } = useAuth()
  const [q, setQ] = useState('')
  const [mine, setMine] = useState(false)
  const { data, error } = useLoad(() => getBalances(mine), [mine])
  if (session && !canSeeMoney(session.user)) return <Navigate to="/home" replace />
  const shown = data ? filterBalances(data.items, q) : []

  return (
    <>
      <ClinicBanner
        title="المتبقي عند المرضى"
        subtitle={session?.user.role === 'DOCTOR' ? 'مين لسا عليه مبلغ على علاجاتك أنت، من الأكبر للأصغر.' : 'مين لسا عليه مبلغ للعيادة، من الأكبر للأصغر.'}
      />
      <div className="flex max-w-4xl flex-col gap-5">
        {session?.user.role === 'OWNER' && (
          <div role="tablist" aria-label="نطاق المتبقي" className="flex gap-2">
            {(
              [
                [false, 'متبقي العيادة'],
                [true, 'متبقي علاجاتك'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={mine === v}
                onClick={() => setMine(v)}
                className={`h-10 cursor-pointer rounded-full border px-4 text-sm font-semibold ${mine === v ? 'border-brand bg-brand text-on-brand' : 'border-line bg-white'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {!data ? (
          <Loading error={error} />
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-1 basis-44 flex-col gap-1 rounded-2xl border border-line bg-white p-5">
                <span className="text-sm text-muted">إجمالي المتبقي</span>
                <span className="text-2xl font-bold" data-testid="balances-total">
                  <Money agorot={data.totalRemaining} />
                </span>
              </div>
              <div className="flex flex-1 basis-44 flex-col gap-1 rounded-2xl border border-line bg-white p-5">
                <span className="text-sm text-muted">عدد المرضى</span>
                <span className="text-2xl font-bold" data-testid="balances-count">
                  {data.items.length}
                </span>
              </div>
            </div>
            <Card title="المرضى">
              <input
                type="search"
                aria-label="بحث"
                placeholder="ابحث بالاسم أو الرقم"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="h-11 rounded-xl border border-line bg-white px-3"
              />
              {data.items.length === 0 ? (
                <p className="text-muted">ما في مرضى عليهم مبالغ. كل شي مدفوع.</p>
              ) : shown.length === 0 ? (
                <p className="text-muted">ما لقينا نتيجة.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {shown.map((p) => (
                    <li key={p.patientId} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="balance-row">
                      <span className="flex flex-col">
                        <Link to={`/patients/${p.patientId}`} className="font-semibold underline">
                          {p.fullName}
                        </Link>
                        <span className="text-sm text-muted">
                          <bdi dir="ltr">{p.phone}</bdi> · دفع <Money agorot={p.paid} /> من <Money agorot={p.total} />
                          {p.lastPaidAt && (
                            <>
                              {' '}
                              · آخر دفعة <DateText value={p.lastPaidAt} />
                            </>
                          )}
                        </span>
                      </span>
                      <strong className="text-lg text-[#b42318]">
                        <Money agorot={p.remaining} />
                      </strong>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  )
}
