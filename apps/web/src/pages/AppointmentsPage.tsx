import { useState } from 'react'
import { useAuth } from '../auth/AuthContext.tsx'
import { Loading } from '../components/admin-ui.tsx'
import { AppointmentDialog } from '../components/AppointmentDialog.tsx'
import { AppointmentCard, StatusBadge, StatusCards } from '../components/appointment-ui.tsx'
import { ClinicBanner } from '../components/clinic-ui.tsx'
import { Icon } from '../components/icons.tsx'
import { SimulateIncoming } from '../components/SimulateIncoming.tsx'
import { Button } from '../components/ui.tsx'
import { dayTitle, addDays, dayRange, isDate, localParts, timeLabel, todayDate, weekStart } from '../lib/schedule.ts'
import { filterDay, listAppointments, listDoctors } from '../lib/appointments.ts'
import type { Appointment, DayFilter } from '../lib/appointments.ts'
import { useLoad } from '../lib/useLoad.ts'

type View = 'day' | 'week'

export default function AppointmentsPage() {
  const { session } = useAuth()
  const isDoctor = session?.user.role === 'DOCTOR'
  const [date, setDate] = useState(todayDate())
  const [view, setView] = useState<View>('day')
  const [doctorId, setDoctorId] = useState('')
  const [showCancelled, setShowCancelled] = useState(false)
  const [filter, setFilter] = useState<DayFilter>('ALL')
  const [dialog, setDialog] = useState<{ edit?: Appointment } | null>(null)

  const doctors = useLoad(listDoctors, [])
  const first = view === 'week' ? weekStart(date) : date
  const range = dayRange(first, view === 'week' ? 7 : 1)
  const list = useLoad(() => listAppointments({ ...range, ...(doctorId ? { doctorId } : {}) }), [range.from, range.to, doctorId])

  const sorted = (list.data ?? []).sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const items = view === 'day' ? filterDay(sorted, filter) : sorted.filter((a) => showCancelled || a.status !== 'CANCELLED')
  const step = view === 'week' ? 7 : 1
  const days = view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(first, i)) : [date]
  const changed = () => {
    setDialog(null)
    list.reload()
  }

  return (
    <>
      <ClinicBanner
        title="المواعيد"
        subtitle={view === 'day' ? dayTitle(date) : `أسبوع يبدأ ${dayTitle(first)}`}
        action={
          doctors.data && (
            <button type="button" onClick={() => setDialog({})} className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-xl bg-on-brand px-5 font-bold text-brand">
              <Icon name="plus" size={18} strokeWidth={2.4} />
              موعد جديد
            </button>
          )
        }
      />
      <SimulateIncoming />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" aria-label="السابق" onClick={() => setDate(addDays(date, -step))}>
            →
          </Button>
          <input
            type="date"
            aria-label="اليوم"
            value={date}
            onChange={(e) => isDate(e.target.value) && setDate(e.target.value)}
            className="h-10 rounded-[10px] border-[1.5px] border-brand bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-brand/25"
          />
          <Button variant="secondary" size="sm" aria-label="التالي" onClick={() => setDate(addDays(date, step))}>
            ←
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDate(todayDate())}>
            اليوم
          </Button>
        </div>
        <div role="group" aria-label="طريقة العرض" className="flex gap-2">
          {(
            [
              ['day', 'يوم'],
              ['week', 'أسبوع'],
            ] as const
          ).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`h-10 cursor-pointer rounded-full border px-4 text-sm font-semibold ${view === v ? 'border-brand bg-brand text-on-brand' : 'border-line bg-white'}`}>
              {label}
            </button>
          ))}
        </div>
        {!isDoctor && doctors.data && (
          <label className="flex flex-col gap-1 text-sm font-semibold">
            الدكتور
            <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="h-10 rounded-[10px] border-[1.5px] border-[#b4c4d8] bg-white px-3 font-normal">
              <option value="">كل الدكاترة</option>
              {doctors.data.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </select>
          </label>
        )}
        {view === 'week' && (
          <label className="flex h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
            إظهار الملغية
          </label>
        )}
      </div>

      {!list.data || !doctors.data ? (
        <Loading error={list.error ?? doctors.error} />
      ) : view === 'day' ? (
        <div className="flex flex-col gap-3">
          <StatusCards list={sorted} value={filter} onChange={setFilter} />
          {items.map((a) => (
            <AppointmentCard key={a.id} a={a} onChanged={list.reload} onEdit={(x) => setDialog({ edit: x })} />
          ))}
          {items.length === 0 && <p className="text-[15px] text-muted">{filter === 'ALL' ? 'ما في مواعيد بهذا اليوم.' : 'ما في مواعيد بهالحالة بهذا اليوم.'}</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {days.map((d) => {
            const mine = items.filter((a) => localParts(a.startsAt).date === d)
            return (
              <section key={d} aria-label={dayTitle(d)} className={`flex flex-col gap-2 rounded-xl border bg-white p-3 ${d === todayDate() ? 'border-brand' : 'border-line'}`}>
                <button
                  type="button"
                  onClick={() => {
                    setDate(d)
                    setView('day')
                  }}
                  className="cursor-pointer text-start text-sm font-bold text-brand-dark underline"
                >
                  {dayTitle(d)}
                </button>
                {mine.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setDate(d)
                      setView('day')
                    }}
                    className="flex cursor-pointer flex-col gap-1 rounded-lg bg-page p-2 text-start text-sm"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <bdi dir="ltr" className="font-bold">
                        {timeLabel(a.startsAt)}
                      </bdi>
                      <StatusBadge a={a} />
                    </span>
                    <span>{a.patient.fullName}</span>
                    {!doctorId && !isDoctor && <span className="text-xs text-muted">{a.doctor.fullName}</span>}
                  </button>
                ))}
                {mine.length === 0 && <p className="text-xs text-muted">لا مواعيد</p>}
              </section>
            )
          })}
        </div>
      )}

      {dialog && doctors.data && (
        <AppointmentDialog doctors={doctors.data} {...(dialog.edit ? { edit: dialog.edit } : {})} initialDate={date} {...(doctorId ? { initialDoctorId: doctorId } : {})} onClose={() => setDialog(null)} onSaved={changed} />
      )}
    </>
  )
}
