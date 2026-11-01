import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/AuthContext.tsx'
import { Card, Loading } from '../components/admin-ui.tsx'
import { AppointmentDialog } from '../components/AppointmentDialog.tsx'
import { AppointmentCard } from '../components/appointment-ui.tsx'
import { ClinicBanner } from '../components/clinic-ui.tsx'
import { Icon } from '../components/icons.tsx'
import { listAppointments, listDoctors } from '../lib/appointments.ts'
import type { Appointment } from '../lib/appointments.ts'
import { dayRange, dayTitle, todayDate } from '../lib/schedule.ts'
import { useLoad } from '../lib/useLoad.ts'

export default function HomePage() {
  const { session } = useAuth()
  const today = todayDate()
  const doctors = useLoad(listDoctors, [])
  const list = useLoad(() => listAppointments(dayRange(today)), [today])
  const [dialog, setDialog] = useState<{ edit?: Appointment } | null>(null)

  const all = (list.data ?? []).sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const live = all.filter((a) => a.status !== 'CANCELLED')
  const count = (s: string) => live.filter((a) => a.status === s).length
  const stats: [string, number][] = [
    ['مواعيد اليوم', live.length],
    ['بانتظار التأكيد', count('PENDING')],
    ['مؤكدة', count('CONFIRMED')],
    ['منتهية', count('COMPLETED')],
  ]

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
      {!list.data || !doctors.data ? (
        <Loading error={list.error ?? doctors.error} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stats.map(([label, n]) => (
              <div key={label} className="flex flex-col gap-1 rounded-xl border border-line bg-white p-4">
                <span className="text-sm text-muted">{label}</span>
                <span className="text-3xl font-bold text-brand-dark">{n}</span>
              </div>
            ))}
          </div>
          <Card title="مواعيد اليوم">
            <div className="flex flex-col gap-3">
              {live.map((a) => (
                <AppointmentCard key={a.id} a={a} onChanged={list.reload} onEdit={(x) => setDialog({ edit: x })} />
              ))}
              {live.length === 0 && <p className="text-[15px] text-muted">ما في مواعيد اليوم.</p>}
            </div>
            <Link to="/appointments" className="text-sm font-bold text-brand-dark underline">
              فتح التقويم
            </Link>
          </Card>
        </>
      )}
      {dialog && doctors.data && (
        <AppointmentDialog
          doctors={doctors.data}
          {...(dialog.edit ? { edit: dialog.edit } : {})}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            list.reload()
          }}
        />
      )}
    </>
  )
}
