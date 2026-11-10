import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/AuthContext.tsx'
import { Card, Loading, Money } from '../components/admin-ui.tsx'
import { AppointmentDialog } from '../components/AppointmentDialog.tsx'
import { AppointmentCard, StatusCards } from '../components/appointment-ui.tsx'
import { ClinicBanner } from '../components/clinic-ui.tsx'
import { Icon } from '../components/icons.tsx'
import { awaitingReply, filterDay, listAppointments, listDoctors } from '../lib/appointments.ts'
import type { Appointment, DayFilter } from '../lib/appointments.ts'
import { getSalaryMonth, isSalaryDue, monthNumber } from '../lib/salaries.ts'
import { addDays, dayRange, dayTitle, todayDate } from '../lib/schedule.ts'
import { useLoad } from '../lib/useLoad.ts'

export default function HomePage() {
  const { session } = useAuth()
  const today = todayDate()
  const doctors = useLoad(listDoctors, [])
  const list = useLoad(() => listAppointments(dayRange(today)), [today])
  // Unanswered ones: from last week (already missed) to the end of the coming weeks.
  const waiting = useLoad(() => listAppointments(dayRange(addDays(today, -7), 30)), [today])
  // From the 25th the owner is reminded to pay this month's salaries.
  const month = today.slice(0, 7)
  const salariesDue = session?.user.role === 'OWNER' && isSalaryDue(month, today)
  const salaries = useLoad(() => (salariesDue ? getSalaryMonth(month) : Promise.resolve(null)), [salariesDue, month])
  const owed = salaries.data?.entries.filter((e) => e.remaining > 0) ?? []
  const [filter, setFilter] = useState<DayFilter>('ALL')
  const [dialog, setDialog] = useState<{ edit?: Appointment } | null>(null)

  const all = (list.data ?? []).sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const shown = filterDay(all, filter)
  const pending = awaitingReply(waiting.data ?? [])
  const refresh = () => {
    list.reload()
    waiting.reload()
  }

  return (
    <>
      <ClinicBanner title={`أهلاً ${session?.user.fullName ?? ''}`} subtitle={dayTitle(today)} action={
        doctors.data && (
          <button type="button" onClick={() => setDialog({})} className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-xl bg-on-brand px-5 font-bold text-brand">
            <Icon name="plus" size={18} strokeWidth={2.4} />
            موعد جديد
          </button>
        )
      } />
      {!list.data || !doctors.data || !waiting.data ? (
        <Loading error={list.error ?? doctors.error ?? waiting.error} />
      ) : (
        <>
          <StatusCards list={all} value={filter} onChange={setFilter} />
          {owed.length > 0 && salaries.data && (
            <Card title={`رواتب شهر ${monthNumber(month)} جاهزة للصرف`} hint={`${owed.length} موظف لسا ما انصرفلهم الراتب كامل.`}>
              <div className="flex flex-wrap items-center justify-between gap-3" data-testid="salary-reminder">
                <span className="text-lg font-bold">
                  المتبقي <Money agorot={salaries.data.totals.remaining} />
                </span>
                <Link to="/salaries" className="text-sm font-bold text-brand-dark underline">
                  صرف الرواتب
                </Link>
              </div>
            </Card>
          )}
          <Card title="مواعيد اليوم">
            <div className="flex flex-col gap-3" data-testid="today-list">
              {shown.map((a) => (
                <AppointmentCard key={a.id} a={a} onChanged={refresh} onEdit={(x) => setDialog({ edit: x })} />
              ))}
              {shown.length === 0 && <p className="text-[15px] text-muted">{filter === 'ALL' ? 'ما في مواعيد اليوم.' : 'ما في مواعيد بهالحالة اليوم.'}</p>}
            </div>
            <Link to="/appointments" className="text-sm font-bold text-brand-dark underline">
              فتح التقويم
            </Link>
          </Card>
          {pending.length > 0 && (
            <Card title={`بانتظار رد المريض (${pending.length})`} hint="المريض ما رد على رسالة التأكيد. اتصل فيه: لو جاي اضغط تأكيد، ولو لا اضغط إلغاء والوقت بيرجع متاح لغيره.">
              <div className="flex flex-col gap-3" data-testid="awaiting-list">
                {pending.map((a) => (
                  <AppointmentCard key={a.id} a={a} showDate onChanged={refresh} onEdit={(x) => setDialog({ edit: x })} />
                ))}
              </div>
            </Card>
          )}
        </>
      )}
      {dialog && doctors.data && (
        <AppointmentDialog
          doctors={doctors.data}
          {...(dialog.edit ? { edit: dialog.edit } : {})}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            refresh()
          }}
        />
      )}
    </>
  )
}
