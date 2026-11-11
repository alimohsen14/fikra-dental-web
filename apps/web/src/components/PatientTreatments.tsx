import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/AuthContext.tsx'
import { canEditTreatments, canSeeMoney } from '../lib/access.ts'
import { toothLabel, teethText } from '../lib/teeth.ts'
import { getPatientFinance, listTreatments, sessionsDone, toothMarks, typeLabel, typeLabels } from '../lib/treatments.ts'
import { defaultSet, setOfTeeth } from '../lib/teeth.ts'
import type { ToothSet } from '../lib/teeth.ts'
import { useLoad } from '../lib/useLoad.ts'
import { TreatmentBadge } from '../pages/TreatmentPage.tsx'
import { Card, DateText, Loading, Money } from './admin-ui.tsx'
import { buildStatement } from '../lib/statement.ts'
import { AccountStatement } from './AccountStatement.tsx'
import { ToothChart, ToothSetToggle } from './ToothChart.tsx'

/** The "treatments" tab of the patient file: money cards, the chart with treated teeth colored, and the list. */
export function PatientTreatments({ patientId, birthDate }: { patientId: string; birthDate: string | null }) {
  const { session } = useAuth()
  const user = session!.user
  const list = useLoad(() => listTreatments({ patientId }), [patientId])
  const finance = useLoad(() => (canSeeMoney(user) ? getPatientFinance(patientId) : Promise.resolve(null)), [patientId])
  const [override, setOverride] = useState<ToothSet | null>(null)
  const [tooth, setTooth] = useState<number | null>(null)

  if (!list.data) return <Loading error={list.error} />
  const all = list.data
  const marks = toothMarks(all)
  const treated = Object.keys(marks).map(Number)
  const set = override ?? (treated.length > 0 ? setOfTeeth(treated) : defaultSet(birthDate))
  const statement = buildStatement(all)
  const history = tooth === null ? [] : all.filter((t) => t.toothCodes.includes(tooth))

  return (
    <div className="flex flex-col gap-5">
      {finance.data && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="finance-cards">
          {(
            [
              ['إجمالي العلاجات', finance.data.total, 'total'],
              ['المدفوع', finance.data.paid, 'paid'],
              ['المتبقي', finance.data.remaining, 'remaining'],
            ] as const
          ).map(([label, amount, key]) => (
            <div key={key} className="flex flex-col gap-1 rounded-xl border border-line bg-white p-4" data-testid={`finance-${key}`}>
              <span className="text-sm text-muted">{label}</span>
              <span className="text-2xl font-bold text-brand-dark">
                <Money agorot={amount} />
              </span>
            </div>
          ))}
        </div>
      )}
      <Card title="مخطط الأسنان" hint="الأسنان الملوّنة عليها علاج: البرتقالي علاج مفتوح، والأخضر علاج منتهٍ. اضغط على سن لعرض تاريخه.">
        <ToothSetToggle value={set} onChange={setOverride} />
        <ToothChart set={set} marks={marks} selected={tooth === null ? [] : [tooth]} onPick={(c) => setTooth(tooth === c ? null : c)} />
        {tooth !== null && (
          <div className="flex flex-col gap-2 rounded-xl bg-page p-4" data-testid="tooth-history">
            <strong>السن {toothLabel(tooth)}</strong>
            {history.length === 0 ? (
              <p className="text-sm text-muted">لا توجد علاجات على هذا السن.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {history.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-3 text-sm">
                    <TreatmentBadge status={t.status} />
                    <Link to={`/treatments/${t.id}`} className="font-bold text-brand-dark underline">
                      {typeLabel(t.teeth.find((x) => x.toothCode === tooth)!.treatmentType)}
                    </Link>
                    <span className="text-muted">
                      <DateText value={t.startedAt} /> · {t.doctor.fullName}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>
      <Card title="العلاجات">
        {canEditTreatments(user) && (
          <Link to={`/treatments/new?patientId=${patientId}`} className="inline-flex h-10 items-center self-start rounded-xl bg-brand px-4 text-sm font-semibold text-on-brand">
            علاج جديد لهذا المريض
          </Link>
        )}
        {all.length === 0 ? (
          <p className="text-[15px] text-muted">لا توجد علاجات لهذا المريض بعد.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="علاجات المريض">
            {all.map((t) => (
              <li key={t.id}>
                <Link to={`/treatments/${t.id}`} data-testid="patient-treatment" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-4 hover:border-brand">
                  <span className="flex flex-col gap-0.5">
                    <span className="font-bold">{typeLabels(t).join('، ')}</span>
                    <span className="text-sm text-muted">
                      الأسنان <bdi dir="ltr">{teethText(t.toothCodes)}</bdi> · الجلسات {sessionsDone(t)}/{t.plannedSessions} · {t.doctor.fullName}
                      {t.remaining !== undefined ? (
                        <>
                          {' '}
                          · المتبقي <Money agorot={t.remaining} />
                        </>
                      ) : null}
                    </span>
                  </span>
                  <TreatmentBadge status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {statement && statement.rows.length > 0 && <AccountStatement statement={statement} patientName={all[0]!.patient.fullName} />}
    </div>
  )
}
