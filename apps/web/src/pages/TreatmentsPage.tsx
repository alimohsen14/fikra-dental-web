import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/AuthContext.tsx'
import { Loading, Money } from '../components/admin-ui.tsx'
import { BannerLink, ClinicBanner } from '../components/clinic-ui.tsx'
import { Icon } from '../components/icons.tsx'
import { canEditTreatments, canSeeTreatments } from '../lib/access.ts'
import { teethText } from '../lib/teeth.ts'
import { listTreatments, sessionsDone, typeLabels } from '../lib/treatments.ts'
import type { TreatmentStatus } from '../lib/treatments.ts'
import { useLoad } from '../lib/useLoad.ts'
import { TreatmentBadge } from './TreatmentPage.tsx'

const TABS: [TreatmentStatus | 'ALL', string][] = [
  ['OPEN', 'مفتوحة'],
  ['CLOSED', 'مغلقة'],
  ['CANCELLED', 'ملغية'],
  ['ALL', 'الكل'],
]

export default function TreatmentsPage() {
  const { session } = useAuth()
  const [tab, setTab] = useState<TreatmentStatus | 'ALL'>('OPEN')
  const [q, setQ] = useState('')
  const [mine, setMine] = useState(false)
  const { data, error } = useLoad(() => listTreatments({ mine }), [mine])
  if (!session) return null
  if (!canSeeTreatments(session.user)) return <Loading error="ما عندك صلاحية لهذه الصفحة." />
  const rows = (data ?? []).filter((t) => (tab === 'ALL' || t.status === tab) && (!q.trim() || t.patient.fullName.includes(q.trim())))
  const isOwner = session.user.role === 'OWNER'
  const isDoctor = session.user.role === 'DOCTOR'
  const withMoney = rows.some((t) => t.paid !== undefined)

  return (
    <>
      <ClinicBanner
        title="العلاجات"
        subtitle={isDoctor ? 'علاجاتك أنت: دفعاتها وجلساتها. علاجات باقي الدكاترة بتلاقيها في ملف المريض.' : 'كل علاجات العيادة ودفعاتها وجلساتها.'}
        action={
          canEditTreatments(session.user) ? (
            <BannerLink to="/treatments/new">
              <Icon name="plus" size={18} strokeWidth={2.4} />
              علاج جديد
            </BannerLink>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex max-w-md flex-1 basis-72 flex-col gap-1.5 text-sm font-semibold">
          بحث باسم المريض
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-12 rounded-[10px] border-[1.5px] border-brand bg-white px-3.5 text-base font-normal outline-none focus:ring-2 focus:ring-brand/25"
          />
        </label>
        {isOwner && (
          <div role="tablist" aria-label="نطاق العلاجات" className="flex gap-2">
            {(
              [
                [false, 'علاجات العيادة'],
                [true, 'علاجاتك'],
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
        <div role="tablist" aria-label="حالة العلاج" className="flex flex-wrap gap-2">
          {TABS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={tab === v}
              onClick={() => setTab(v)}
              className={`h-10 cursor-pointer rounded-full border px-4 text-sm font-semibold ${tab === v ? 'border-brand bg-brand text-on-brand' : 'border-line bg-white'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <div className="relative overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="bg-brand-tint text-brand-dark">
                  {['المريض', 'العلاج', 'الأسنان', 'الدكتور', 'الجلسات', ...(withMoney ? ['المدفوع', 'المتبقي'] : []), 'الحالة'].map((h) => (
                    <th key={h} className="px-4 py-3 text-start font-semibold">
                      {h}
                    </th>
                  ))}
                  <th className="px-4 py-3">
                    <span className="sr-only">إجراءات</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-t border-[#edf1f6]" data-testid="treatment-row">
                    <td className="px-4 py-3.5 font-semibold">{t.patient.fullName}</td>
                    <td className="px-4 py-3.5">{typeLabels(t).join('، ')}</td>
                    <td className="px-4 py-3.5">
                      <bdi dir="ltr">{teethText(t.toothCodes)}</bdi>
                    </td>
                    <td className="px-4 py-3.5">{t.doctor.fullName}</td>
                    <td className="px-4 py-3.5">
                      {sessionsDone(t)} / {t.plannedSessions}
                    </td>
                    {withMoney && (
                      <>
                        <td className="px-4 py-3.5">{t.paid !== undefined ? <Money agorot={t.paid} /> : '-'}</td>
                        <td className="px-4 py-3.5">{t.remaining !== undefined ? <Money agorot={t.remaining} /> : '-'}</td>
                      </>
                    )}
                    <td className="px-4 py-3.5">
                      <TreatmentBadge status={t.status} />
                    </td>
                    <td className="px-4 py-3.5">
                      <Link to={`/treatments/${t.id}`} className="font-bold text-brand-dark underline">
                        فتح
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && <p className="text-[15px] text-muted">{q.trim() ? 'ما في علاج بهالاسم.' : 'ما في علاجات هنا.'}</p>}
        </>
      )}
    </>
  )
}
