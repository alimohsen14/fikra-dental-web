import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Badge, DateText, Loading } from '../components/admin-ui.tsx'
import { BannerLink, ClinicBanner } from '../components/clinic-ui.tsx'
import { Icon } from '../components/icons.tsx'
import { Button } from '../components/ui.tsx'
import { dateOnly } from '../lib/format.ts'
import { GENDER_LABELS, listPatients, PAGE_SIZE } from '../lib/patients.ts'
import { useLoad } from '../lib/useLoad.ts'

export default function PatientsPage() {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [archived, setArchived] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  const { data, error } = useLoad(() => listPatients({ q: debounced, page, archived }), [debounced, page, archived])
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <>
      <ClinicBanner
        title="المرضى"
        subtitle="كل مرضى العيادة، يشوفهم المالك والدكاترة والسكرتارية."
        action={
          <BannerLink to="/patients/new">
            <Icon name="plus" size={18} strokeWidth={2.4} />
            مريض جديد
          </BannerLink>
        }
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex max-w-md flex-1 basis-72 flex-col gap-1.5 text-sm font-semibold">
          بحث بالاسم أو الهاتف أو الهوية
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="مثال: محمد أو 0599" className="h-12 rounded-[10px] border-[1.5px] border-brand bg-white px-3.5 text-base font-normal outline-none focus:ring-2 focus:ring-brand/25" />
        </label>
        <div role="tablist" aria-label="نوع القائمة" className="flex gap-2">
          {[
            [false, 'المرضى'],
            [true, 'الأرشيف'],
          ].map(([v, label]) => (
            <button
              key={String(v)}
              type="button"
              role="tab"
              aria-selected={archived === v}
              onClick={() => {
                setArchived(v as boolean)
                setPage(1)
              }}
              className={`h-10 cursor-pointer rounded-full border px-4 text-sm font-semibold ${archived === v ? 'border-brand bg-brand text-on-brand' : 'border-line bg-white'}`}
            >
              {label as string}
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full min-w-[700px] border-collapse text-sm">
              <thead>
                <tr className="bg-brand-tint text-brand-dark">
                  {['الاسم', 'الهاتف', 'الجنس', 'تاريخ الميلاد', 'ملاحظات'].map((h) => (
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
                {data.items.map((p) => (
                  <tr key={p.id} className="border-t border-[#edf1f6]">
                    <td className="px-4 py-3.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{p.fullName}</span>
                        {p.medicalAlerts && <Badge label="تنبيه طبي" bg="#fde8e8" fg="#9b1c1c" />}
                      </span>
                    </td>
                    <td className="px-4 py-3.5"><bdi dir="ltr">{p.phone}</bdi></td>
                    <td className="px-4 py-3.5">{p.gender ? GENDER_LABELS[p.gender] : '-'}</td>
                    <td className="px-4 py-3.5 text-[#33445b]">{p.birthDate ? <DateText value={dateOnly(p.birthDate)} /> : '-'}</td>
                    <td className="max-w-56 truncate px-4 py-3.5 text-[#33445b]">{p.notes || '-'}</td>
                    <td className="px-4 py-3.5">
                      <Link to={`/patients/${p.id}`} className="font-bold text-brand-dark underline">
                        فتح الملف
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.items.length === 0 && <p className="text-[15px] text-muted">{debounced ? 'ما في مريض بهالبحث.' : archived ? 'الأرشيف فاضي.' : 'ما في مرضى لسا، أضف أول مريض.'}</p>}
          {data.total > PAGE_SIZE && (
            <div className="flex items-center gap-3">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                السابق
              </Button>
              <span className="text-sm text-muted">
                صفحة {page} من {pages} ({data.total} مريض)
              </span>
              <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                التالي
              </Button>
            </div>
          )}
        </>
      )}
    </>
  )
}
