import { useState } from 'react'
import { Link } from 'react-router'
import { Card, DateText, Loading, Money, PageBanner } from '../../components/admin-ui.tsx'
import { TextField } from '../../components/ui.tsx'
import { getCashPage, PAY_METHOD_LABELS } from '../../lib/admin.ts'
import { todayInput } from '../../lib/format.ts'
import { useLoad } from '../../lib/useLoad.ts'

/** What the platform really received. Cheques are on the cheques page until they are cashed; from then they are cash here. */
export default function AdminCashPage() {
  const today = todayInput()
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`)
  const [to, setTo] = useState(today)
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to
  const { data, error } = useLoad(() => (ok ? getCashPage(from, to) : Promise.resolve(null)), [from, to, ok])

  return (
    <>
      <PageBanner title="الكاش" subtitle="ما استلمناه فعلاً من العيادات (نقداً) والشكات بعد صرفها. الشكات التي لم تُصرف بعد في صفحة «الشكات»." />
      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="من" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <TextField label="إلى" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
        </div>
      </Card>
      {!ok ? (
        <p className="text-sm text-[#9b1c1c]">اختر فترة صحيحة.</p>
      ) : !data ? (
        <Loading error={error} />
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-1 basis-40 flex-col gap-1 rounded-xl border border-line bg-white p-4">
              <span className="text-[13px] text-muted">إجمالي الكاش في الفترة</span>
              <span className="text-2xl font-bold text-[#0b6b3a]" data-testid="cash-total">
                <Money agorot={data.total} />
              </span>
            </div>
            <div className="flex flex-1 basis-40 flex-col gap-1 rounded-xl border border-line bg-white p-4">
              <span className="text-[13px] text-muted">منها من شكات مصروفة</span>
              <span className="text-2xl font-bold text-[#2a4a9b]" data-testid="cash-from-cheques">
                <Money agorot={data.fromCheques} />
              </span>
            </div>
          </div>
          <Card title="الدفعات">
            {data.items.length === 0 ? (
              <p className="text-muted">لا توجد دفعات في هذه الفترة.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {data.items.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="cash-row">
                    <span className="flex flex-col gap-0.5">
                      <Link to={`/admin/clinics/${x.clinic.id}`} className="font-semibold underline">
                        {x.clinic.name}
                      </Link>
                      <span className="text-sm text-muted">
                        <DateText value={x.at} /> · {x.fromCheque ? `شك${x.chequeNumber ? ` رقم ${x.chequeNumber}` : ''} (بعد الصرف)` : PAY_METHOD_LABELS[x.method]}
                        {x.note ? ` · ${x.note}` : ''}
                      </span>
                    </span>
                    <strong className="text-lg">
                      <Money agorot={x.amount} />
                    </strong>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  )
}
