import { useState } from 'react'
import { Card, DateText, Loading, Money, PageBanner } from '../../components/admin-ui.tsx'
import { SubChequeBadge, SubChequeModal } from '../../components/sub-cheque-ui.tsx'
import { Button, TextField } from '../../components/ui.tsx'
import { listSubCheques, SUB_CHEQUE_LABELS } from '../../lib/admin.ts'
import type { SubChequeStatus, Sum } from '../../lib/admin.ts'
import { useLoad } from '../../lib/useLoad.ts'

const TABS: ('ALL' | SubChequeStatus)[] = ['ALL', 'PENDING', 'CASHED', 'RETURNED', 'CANCELLED']

function Box({ label, sum, tone, testId }: { label: string; sum: Sum; tone?: 'warn' | 'bad'; testId: string }) {
  const color = tone === 'bad' ? '#9b1c1c' : tone === 'warn' ? '#7a4a00' : '#152437'
  return (
    <div className="flex flex-1 basis-40 flex-col gap-1 rounded-xl border border-line bg-white p-4" data-testid={testId}>
      <span className="text-[13px] text-muted">{label}</span>
      <span style={{ color }} className="text-2xl font-bold">
        <Money agorot={sum.amount} />
      </span>
      <span className="text-xs text-muted">{sum.count} شك</span>
    </div>
  )
}

/** Every cheque clinics paid their subscription with (incoming only). The money counts as cash only once a cheque is cashed. */
export default function AdminChequesPage() {
  const [tab, setTab] = useState<'ALL' | SubChequeStatus>('ALL')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const { data, error, reload } = useLoad(() => listSubCheques(tab, q), [tab, q])
  const t = data?.totals

  return (
    <>
      <PageBanner title="الشكات" subtitle="الشكات التي دفعت بها العيادات اشتراكاتها (واردة فقط). تدخل الكاش عند «تم الصرف»." />
      {t && (
        <div className="flex flex-wrap gap-3">
          <Box label="لم تُصرف بعد" sum={t.pending} testId="sc-pending" />
          <Box label="موعد صرفها اليوم" sum={t.dueToday} tone={t.dueToday.count > 0 ? 'warn' : undefined} testId="sc-today" />
          <Box label="فات موعدها ولم تُصرف" sum={t.overdue} tone={t.overdue.count > 0 ? 'bad' : undefined} testId="sc-overdue" />
          <Box label="مصروفة" sum={t.cashed} testId="sc-cashed" />
          <Box label="مرتجعة" sum={t.returned} testId="sc-returned" />
        </div>
      )}
      <Card title="قائمة الشكات">
        <div role="tablist" aria-label="تصفية الشكات" className="flex flex-wrap gap-2">
          {TABS.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={tab === s}
              onClick={() => setTab(s)}
              className={`h-10 cursor-pointer rounded-full border px-4 text-sm font-bold ${tab === s ? 'border-brand-dark bg-brand-dark text-on-brand' : 'border-line bg-white'}`}
            >
              {s === 'ALL' ? 'الكل' : SUB_CHEQUE_LABELS[s]}
            </button>
          ))}
        </div>
        <TextField label="بحث" placeholder="اسم العيادة أو صاحب الشك أو رقم الشك أو البنك" value={q} onChange={(e) => setQ(e.target.value)} />
        {!data ? (
          <Loading error={error} />
        ) : data.items.length === 0 ? (
          <p className="text-muted">لا توجد شكات.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {data.items.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid={`sub-cheque-${c.chequeNumber ?? c.id}`}>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{c.clinic.name}</span>
                    <SubChequeBadge c={c} />
                    {c.due === 'today' && <span className="text-sm font-bold text-[#7a4a00]">يُصرف اليوم</span>}
                    {c.due === 'overdue' && <span className="text-sm font-bold text-[#9b1c1c]">فات موعده</span>}
                  </span>
                  <span className="text-sm text-muted">
                    يُصرف <DateText value={c.dueDate} />
                    {c.chequeNumber ? ` · رقم ${c.chequeNumber}` : ''}
                    {c.bankName ? ` · ${c.bankName}` : ''}
                    {c.drawerName ? ` · ${c.drawerName}` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <strong className="text-lg">
                    <Money agorot={c.amount} />
                  </strong>
                  <Button variant="secondary" size="sm" onClick={() => setOpen(c.id)}>
                    فتح
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {open && <SubChequeModal id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  )
}
