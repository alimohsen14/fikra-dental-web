import { useState } from 'react'
import { Card, Loading } from '../components/admin-ui.tsx'
import { ClinicBanner } from '../components/clinic-ui.tsx'
import { Alert, Button } from '../components/ui.tsx'
import { ApiError } from '../lib/api.ts'
import { listDoctors, setWorkingPeriods } from '../lib/appointments.ts'
import type { Doctor } from '../lib/appointments.ts'
import { emptyWeek, minuteLabel, periodsFromWeek, weekFromPeriods, WEEKDAYS } from '../lib/schedule.ts'
import type { WeekRows } from '../lib/schedule.ts'
import { useLoad } from '../lib/useLoad.ts'

const TIMES = Array.from({ length: 49 }, (_, i) => i * 30) // 00:00 .. 24:00

function Editor({ doctor, onSaved }: { doctor: Doctor; onSaved: () => void }) {
  const [week, setWeek] = useState<WeekRows>(() => weekFromPeriods(doctor.workingPeriods))
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const edit = (d: number, rows: WeekRows[number]) => {
    setWeek({ ...emptyWeek(), ...week, [d]: rows })
    setDone(false)
  }
  async function save() {
    const r = periodsFromWeek(week)
    if (!r.ok) return setError(r.error)
    setBusy(true)
    setError(null)
    try {
      await setWorkingPeriods(doctor.id, r.periods)
      setDone(true)
      onSaved()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'صار خطأ غير متوقع، جرب مرة ثانية')
    } finally {
      setBusy(false)
    }
  }
  const select = (label: string, value: number, onChange: (v: number) => void) => (
    <select aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-10 rounded-lg border-[1.5px] border-[#b4c4d8] bg-white px-2 text-sm">
      {TIMES.map((t) => (
        <option key={t} value={t}>
          {minuteLabel(t)}
        </option>
      ))}
    </select>
  )

  return (
    <Card title={`دوام ${doctor.fullName}`} hint="كل يوم ممكن يكون إله فترة أو أكتر (مثلاً صباحية ومسائية). اليوم بدون فترات = إجازة. المواعيد بتنحجز كل نص ساعة.">
      <div className="flex flex-col divide-y divide-line">
        {WEEKDAYS.map((name, d) => (
          <div key={name} className="flex flex-wrap items-center gap-3 py-3">
            <span className="w-24 font-semibold">{name}</span>
            <div className="flex flex-1 flex-col gap-2">
              {(week[d] ?? []).length === 0 && <span className="text-sm text-muted">إجازة</span>}
              {(week[d] ?? []).map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  من {select(`${name} بداية`, r.start, (v) => edit(d, (week[d] ?? []).map((x, j) => (j === i ? { ...x, start: v } : x))))}
                  إلى {select(`${name} نهاية`, r.end, (v) => edit(d, (week[d] ?? []).map((x, j) => (j === i ? { ...x, end: v } : x))))}
                  <button type="button" onClick={() => edit(d, (week[d] ?? []).filter((_, j) => j !== i))} className="cursor-pointer text-sm font-semibold text-[#b42318] underline">
                    حذف
                  </button>
                </div>
              ))}
            </div>
            <Button variant="secondary" size="sm" onClick={() => edit(d, [...(week[d] ?? []), { start: 540, end: 900 }])}>
              + فترة
            </Button>
          </div>
        ))}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {done && <Alert tone="success">انحفظ دوام الدكتور.</Alert>}
      <div>
        <Button busy={busy} onClick={save}>
          حفظ الدوام
        </Button>
      </div>
    </Card>
  )
}

export default function HoursPage() {
  const doctors = useLoad(listDoctors, [])
  const [id, setId] = useState('')
  const doctor = doctors.data?.find((d) => d.id === id) ?? doctors.data?.[0]
  return (
    <>
      <ClinicBanner title="أوقات الدوام" subtitle="حدد متى كل دكتور متاح. بدون دوام ما بينحجز عنده أي موعد." />
      {!doctors.data ? (
        <Loading error={doctors.error} />
      ) : (
        <>
          {doctors.data.length > 1 && (
            <label className="flex max-w-xs flex-col gap-1.5 text-sm font-semibold">
              الدكتور
              <select value={doctor?.id ?? ''} onChange={(e) => setId(e.target.value)} className="h-12 rounded-[10px] border-[1.5px] border-[#b4c4d8] bg-white px-3 text-base font-normal">
                {doctors.data.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fullName}
                  </option>
                ))}
              </select>
            </label>
          )}
          {doctor && <Editor key={doctor.id} doctor={doctor} onSaved={doctors.reload} />}
        </>
      )}
    </>
  )
}
