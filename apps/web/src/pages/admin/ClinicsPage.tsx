import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { DateText, Loading, Money, PageBanner, StateBadge } from '../../components/admin-ui.tsx'
import { Flash } from '../../components/Flash.tsx'
import { Icon } from '../../components/icons.tsx'
import type { ClinicRow } from '../../lib/admin.ts'
import { listClinics } from '../../lib/admin.ts'
import { endedNote } from '../../lib/forms.ts'
import { useLoad } from '../../lib/useLoad.ts'

type Tab = 'all' | 'active' | 'expired' | 'suspended' | 'unpaid'

const TABS: { id: Tab; label: string; match: (r: ClinicRow) => boolean }[] = [
  { id: 'all', label: 'الكل', match: () => true },
  { id: 'active', label: 'فعّالة', match: (r) => r.state === 'ACTIVE' },
  { id: 'expired', label: 'منتهية', match: (r) => r.state === 'GRACE' || r.state === 'EXPIRED' },
  { id: 'suspended', label: 'موقوفة', match: (r) => r.state === 'SUSPENDED' },
  { id: 'unpaid', label: 'عليها مبلغ', match: (r) => r.billing.totalRemaining > 0 },
]

function Owes({ r }: { r: ClinicRow }) {
  if (r.billing.status === 'NONE') return <span className="text-muted">-</span>
  if (r.billing.totalRemaining > 0) return <span className="font-semibold text-[#9b1c1c]">عليها <Money agorot={r.billing.totalRemaining} /></span>
  return <span className="font-semibold text-[#0b6b3a]">مدفوع</span>
}

export default function ClinicsPage() {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [tab, setTab] = useState<Tab>('all')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const { data, error } = useLoad(() => listClinics(debounced), [debounced])

  const cards = data && [
    { label: 'كل العيادات', value: data.summary.total, color: '#0560c8' },
    { label: 'فعّالة', value: data.summary.active, color: '#0b6b3a' },
    { label: 'ضمن المهلة', value: data.summary.grace, color: '#b7791f' },
    { label: 'منتهية', value: data.summary.expired, color: '#9b1c1c' },
    { label: 'موقوفة', value: data.summary.suspended, color: '#3d4b60' },
    { label: 'عليها مبلغ', value: data.summary.unpaid, color: '#0560c8' },
  ]
  const attention = (data?.items ?? [])
    .filter((r) => r.state === 'GRACE' || r.state === 'EXPIRED')
    .sort((a, b) => new Date(a.subscriptionEndsAt!).getTime() - new Date(b.subscriptionEndsAt!).getTime())
  const rows = data?.items.filter(TABS.find((t) => t.id === tab)!.match) ?? []

  return (
    <>
      <PageBanner
        title="العيادات"
        subtitle="كل العيادات المشتركة، وحالة اشتراكها والمبالغ المتبقية عليها."
        action={
          <Link to="/admin/clinics/new" className="inline-flex h-12 items-center gap-2 rounded-xl bg-white px-5 font-bold text-[#033f8c]">
            <Icon name="plus" size={18} strokeWidth={2.4} />
            عيادة جديدة
          </Link>
        }
      />
      <Flash />
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            {cards!.map((c) => (
              <div key={c.label} style={{ borderTopColor: c.color }} className="flex flex-1 basis-36 flex-col gap-1 rounded-xl border border-line border-t-4 bg-white p-4">
                <span className="text-[13px] text-muted">{c.label}</span>
                <span style={{ color: c.color }} className="text-3xl leading-tight font-bold">
                  {c.value}
                </span>
              </div>
            ))}
          </div>

          {attention.length > 0 && (
            <section className="flex flex-col gap-3.5 rounded-xl border border-[#f0cf8f] bg-white p-5" aria-label="تحتاج متابعة">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-lg font-bold">انتهى اشتراكها وتحتاج متابعة</h2>
                <p className="text-sm text-muted">بعد المهلة (3 أيام) بيتقفل الدخول لحاله. لما تستلم الدفعة جدد الاشتراك وبتطلع من هون.</p>
              </div>
              {attention.map((r) => {
                const note = endedNote(r)
                return (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-[#fbf8f1] px-3.5 py-3">
                    <div className="flex min-w-48 flex-col gap-0.5">
                      <span className="text-base font-semibold">{r.name}</span>
                      <span style={{ color: note.color }} className="text-sm">
                        {note.text}
                      </span>
                    </div>
                    <span className="text-sm text-[#33445b]">
                      <Owes r={r} />
                    </span>
                    <Link to={`/admin/clinics/${r.id}#renew`} className="inline-flex h-10 items-center rounded-[10px] border border-brand bg-white px-4 text-sm font-semibold text-brand">
                      تجديد الاشتراك
                    </Link>
                  </div>
                )
              })}
            </section>
          )}

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div role="tablist" aria-label="تصفية العيادات" className="flex flex-wrap gap-2">
                {TABS.map((t) => {
                  const on = t.id === tab
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setTab(t.id)}
                      className={`h-10 cursor-pointer rounded-full border px-4 text-sm font-semibold ${on ? 'border-brand bg-brand text-on-brand' : 'border-line bg-white text-brand-dark'}`}
                    >
                      {t.label} ({data.items.filter(t.match).length})
                    </button>
                  )
                })}
              </div>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                بحث بالاسم
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} className="h-10 w-60 rounded-[10px] border border-[#b4c4d8] bg-white px-3 text-base font-normal outline-none focus:border-brand" />
              </label>
            </div>

            <div className="overflow-x-auto rounded-xl border border-line bg-white">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="bg-page text-right text-[#33445b]">
                    {['العيادة', 'المالك', 'تاريخ الإنشاء', 'الاشتراك', 'الحالة', 'المتبقي'].map((h) => (
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
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-[#e8eef6]">
                      <td className="px-4 py-3.5 font-semibold">{r.name}</td>
                      <td className="px-4 py-3.5">{r.owner?.fullName ?? '-'}</td>
                      <td className="px-4 py-3.5 text-[#33445b]"><DateText value={r.createdAt} /></td>
                      <td className="px-4 py-3.5 text-[#33445b]">{r.subscriptionEndsAt ? <DateText value={r.subscriptionEndsAt} /> : 'بدون تاريخ انتهاء'}</td>
                      <td className="px-4 py-3.5"><StateBadge state={r.state} /></td>
                      <td className="px-4 py-3.5"><Owes r={r} /></td>
                      <td className="px-4 py-3.5">
                        <Link to={`/admin/clinics/${r.id}`} className="font-semibold text-brand-dark underline">
                          فتح
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && <p className="text-[15px] text-muted">{data.items.length === 0 && !debounced ? 'ما في عيادات لسا، أنشئ أول عيادة.' : 'ما في عيادات بهالتصفية.'}</p>}
          </section>
        </>
      )}
    </>
  )
}

