import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../auth/AuthContext.tsx'
import { assetUrl } from '../lib/api.ts'
import { formatDate } from '../lib/format.ts'
import type { Statement } from '../lib/statement.ts'
import { STATUS_TEXT } from '../lib/treatments.ts'
import { Card, Money } from './admin-ui.tsx'
import { Button } from './ui.tsx'

const TH = 'border-b border-line px-3 py-2 text-start text-sm font-bold text-muted whitespace-nowrap'
const TD = 'border-b border-line px-3 py-2 align-top'

function Tables({ s }: { s: Statement }) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[15px]" aria-label="علاجات المريض وحسابها">
          <thead>
            <tr>
              <th className={TH}>العلاج</th>
              <th className={TH}>الأسنان</th>
              <th className={TH}>الدكتور</th>
              <th className={TH}>التكلفة</th>
              <th className={TH}>المدفوع</th>
              <th className={TH}>المتبقي</th>
              <th className={TH}>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.id} data-testid="statement-row">
                <td className={`${TD} font-semibold`}>
                  {r.label}
                  <div className="text-xs font-normal text-muted">{formatDate(r.startedAt)}</div>
                </td>
                <td className={TD}>
                  <bdi dir="ltr">{r.teeth}</bdi>
                </td>
                <td className={TD}>{r.doctor}</td>
                <td className={TD}>
                  <Money agorot={r.total} />
                </td>
                <td className={TD}>
                  <Money agorot={r.paid} />
                </td>
                <td className={`${TD} font-bold`}>
                  <Money agorot={r.remaining} />
                </td>
                <td className={TD}>{STATUS_TEXT[r.status]}</td>
              </tr>
            ))}
            <tr className="bg-[#f4f6f8] font-bold" data-testid="statement-total">
              <td className={TD} colSpan={3}>
                المجموع
              </td>
              <td className={TD}>
                <Money agorot={s.total} />
              </td>
              <td className={TD}>
                <Money agorot={s.paid} />
              </td>
              <td className={TD}>
                <Money agorot={s.remaining} />
              </td>
              <td className={TD} />
            </tr>
          </tbody>
        </table>
      </div>
      <h3 className="mt-2 text-base font-bold">الدفعات</h3>
      {s.payments.length === 0 ? (
        <p className="text-[15px] text-muted">ما في دفعات مسجلة.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] border-collapse text-[15px]" aria-label="دفعات المريض">
            <thead>
              <tr>
                <th className={TH}>التاريخ</th>
                <th className={TH}>العلاج</th>
                <th className={TH}>الطريقة</th>
                <th className={TH}>المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {s.payments.map((p) => (
                <tr key={p.id} data-testid="statement-payment" className={p.voided ? 'text-muted' : ''}>
                  <td className={TD}>{formatDate(p.paidAt)}</td>
                  <td className={TD}>{p.treatmentLabel}</td>
                  <td className={TD}>
                    {p.methodLabel}
                    {p.note ? <div className="text-xs text-muted">{p.note}</div> : null}
                  </td>
                  <td className={TD}>
                    {p.voided ? (
                      <>
                        <s>
                          <Money agorot={p.amount} />
                        </s>
                        <div className="text-xs">ملغاة{p.voidReason ? `: ${p.voidReason}` : ''}</div>
                      </>
                    ) : (
                      <Money agorot={p.amount} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/** The patient's account: every treatment with its cost, paid and remaining, then the payments. Printable on the clinic's letterhead. */
export function AccountStatement({ statement, patientName }: { statement: Statement; patientName: string }) {
  const { session } = useAuth()
  const clinic = session?.clinic
  const [printedOn, setPrintedOn] = useState(() => formatDate(new Date()))
  useEffect(() => {
    const refresh = () => setPrintedOn(formatDate(new Date())) // the date on the paper is the day it is printed
    window.addEventListener('beforeprint', refresh)
    return () => window.removeEventListener('beforeprint', refresh)
  }, [])
  return (
    <>
      <Card title="كشف الحساب" hint="كل علاج حساب واحد، مهما كان عدد أسنانه وجلساته. الدفعات الملغاة بتظهر مشطوبة وما بتنحسب.">
        <Tables s={statement} />
        <Button variant="secondary" size="sm" className="self-start" onClick={() => window.print()}>
          طباعة الكشف
        </Button>
      </Card>
      {/* What comes out of the printer: the app is hidden while printing and only this sheet shows (see index.css). */}
      {createPortal(
        <div className="print-only p-8" aria-hidden="true" data-testid="print-sheet">
          <div className="mb-6 flex items-center gap-4 border-b-2 border-black pb-4">
            {clinic?.logoUrl ? <img src={assetUrl(clinic.logoUrl)} alt="" className="size-16 object-contain" /> : null}
            <div className="flex flex-col">
              <span className="text-2xl font-bold">{clinic ? `عيادة ${clinic.name}` : 'العيادة'}</span>
              <span className="text-lg">كشف حساب المريض: {patientName}</span>
              <span className="text-sm">بتاريخ <bdi dir="ltr">{printedOn}</bdi></span>
            </div>
          </div>
          <Tables s={statement} />
        </div>,
        document.body,
      )}
    </>
  )
}
