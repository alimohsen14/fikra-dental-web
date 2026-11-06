import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useParams } from 'react-router'
import { Badge, Card, Loading } from '../components/admin-ui.tsx'
import { PatientFields } from '../components/PatientFields.tsx'
import { Alert, Button } from '../components/ui.tsx'
import { ApiError, assetUrl } from '../lib/api.ts'
import { bookedNote, bookSelf, cancelSelf, getBookingDays, getBookingSlots, getOverview, groupByMonth, monthTitle, moveSelf, registerSelf } from '../lib/booking.ts'
import type { BookingAppointment, BookingOverview } from '../lib/booking.ts'
import { buildPatientBody, EMPTY_PATIENT } from '../lib/patientForm.ts'
import type { PatientFormValues } from '../lib/patientForm.ts'
import { dayTitle, timeLabel, WEEKDAYS, weekdayOf } from '../lib/schedule.ts'
import { useLoad } from '../lib/useLoad.ts'
import { ThemeScope } from '../theme/ThemeScope.tsx'

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'صار خطأ غير متوقع، جرب مرة ثانية')
const dayOfMonth = (date: string) => `${WEEKDAYS[weekdayOf(date)]} ${Number(date.slice(8))}`
const dateOfInstant = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Hebron' })

type View = { name: 'home' } | { name: 'register' } | { name: 'book'; patientId: string; patientName: string; moving?: BookingAppointment } | { name: 'done'; title: string; line: string }

function Choice({ selected, onClick, children }: { selected?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={`min-h-12 cursor-pointer rounded-xl border-[1.5px] px-4 py-2 text-base font-semibold ${selected ? 'border-brand bg-brand text-on-brand' : 'border-[#b4c4d8] bg-white'}`}>
      {children}
    </button>
  )
}

function AppointmentLine({ a }: { a: BookingAppointment }) {
  return (
    <p className="leading-8">
      <span className="font-bold">{dayTitle(dateOfInstant(a.startsAt))}</span> · <bdi dir="ltr">{timeLabel(a.startsAt)}</bdi>
      <br />
      مع {a.doctor.fullName}{' '}
      {a.status === 'CONFIRMED' ? <Badge label="مؤكد" bg="#e3eefb" fg="#033f8c" /> : <Badge label="بانتظار التأكيد" bg="#fff1d6" fg="#7a4b00" />}
    </p>
  )
}

function Home({ token, data, go, reload }: { token: string; data: BookingOverview; go: (v: View) => void; reload: () => void }) {
  const [asking, setAsking] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function cancel(id: string) {
    setBusy(true)
    setError(null)
    try {
      await cancelSelf(token, id)
      setAsking(null)
      go({ name: 'done', title: 'تم إلغاء موعدك', line: 'بتقدر تحجز موعد جديد بأي وقت من نفس الرابط.' })
      reload()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {data.patients.length === 0 ? (
        <Card title="أهلاً فيك" hint={`ما لقينا سجل على الرقم المنتهي بـ ${data.phoneEnding}. إذا هي أول مرة بتزورنا، سجّل بياناتك وبتحجز موعدك.`}>
          <span />
        </Card>
      ) : (
        data.patients.map((p) => (
          <Card key={p.id} title={p.fullName}>
            {p.appointment ? (
              <>
                <div aria-label="موعدك القادم">
                  <p className="text-sm text-muted">موعدك القادم</p>
                  <AppointmentLine a={p.appointment} />
                </div>
                {error && asking === p.appointment.id && <Alert tone="error">{error}</Alert>}
                {asking === p.appointment.id ? (
                  <div className="flex flex-col gap-3">
                    <p className="font-semibold">متأكد بدك تلغي الموعد؟</p>
                    <div className="flex gap-2">
                      <Button variant="danger" busy={busy} onClick={() => cancel(p.appointment!.id)}>
                        نعم، ألغي الموعد
                      </Button>
                      <Button variant="secondary" disabled={busy} onClick={() => setAsking(null)}>
                        رجوع
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => go({ name: 'book', patientId: p.id, patientName: p.fullName, moving: p.appointment! })}>تعديل الموعد</Button>
                    <Button variant="secondary" onClick={() => setAsking(p.appointment!.id)}>
                      إلغاء الموعد
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-muted">ما عندك موعد قادم.</p>
                <Button onClick={() => go({ name: 'book', patientId: p.id, patientName: p.fullName })}>حجز موعد</Button>
              </>
            )}
          </Card>
        ))
      )}
      <Button variant="secondary" onClick={() => go({ name: 'register' })}>
        {data.patients.length === 0 ? 'سجّل بياناتك' : 'مريض جديد؟ سجّل بياناته'}
      </Button>
    </div>
  )
}

function Register({ token, onRegistered, onBack }: { token: string; onRegistered: (id: string, name: string) => void; onBack: () => void }) {
  const [v, setV] = useState<PatientFormValues>(EMPTY_PATIENT)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof PatientFormValues>(k: K, x: PatientFormValues[K]) => setV((s) => ({ ...s, [k]: x }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const r = buildPatientBody(v, undefined, { needPhone: false })
    if ('error' in r) return setError(r.error)
    setError(null)
    setBusy(true)
    try {
      const p = await registerSelf(token, r.body)
      onRegistered(p.id, p.fullName)
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <p className="text-sm leading-7 text-muted">رقم هاتفك بيتسجل تلقائياً من واتساب.</p>
      {error && <Alert tone="error">{error}</Alert>}
      <PatientFields v={v} set={set} showPhone={false} />
      <div className="flex gap-3">
        <Button type="submit" busy={busy}>
          تسجيل ومتابعة للحجز
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onBack}>
          رجوع
        </Button>
      </div>
    </form>
  )
}

function BookFlow({ token, data, patientId, patientName, moving, onDone, onBack }: { token: string; data: BookingOverview; patientId: string; patientName: string; moving?: BookingAppointment; onDone: (title: string, line: string) => void; onBack: () => void }) {
  const [doctorId, setDoctorId] = useState(moving?.doctor.id ?? (data.doctors.length === 1 ? data.doctors[0]!.id : ''))
  const [date, setDate] = useState('')
  const [slot, setSlot] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const days = useLoad(() => (doctorId ? getBookingDays(token, doctorId, moving?.id) : Promise.resolve({ days: [] })), [doctorId])
  const slots = useLoad(() => (doctorId && date ? getBookingSlots(token, doctorId, date, moving?.id) : Promise.resolve({ slots: [] })), [doctorId, date])
  const doctor = data.doctors.find((d) => d.id === doctorId)

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      const r = moving ? await moveSelf(token, moving.id, { startsAt: slot, doctorId }) : await bookSelf(token, { patientId, doctorId, startsAt: slot })
      onDone(moving ? 'تم تعديل موعدك' : 'تم حجز موعدك', `${dayTitle(dateOfInstant(r.startsAt))} · ${timeLabel(r.startsAt)}\n${bookedNote(r.status)}`)
    } catch (e) {
      setError(messageOf(e))
      setSlot('')
      slots.reload() // the time may have just been taken by someone else
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{moving ? `تعديل موعد ${patientName}` : `حجز موعد لـ ${patientName}`}</p>
      {data.doctors.length === 0 ? (
        <Alert tone="warning">ما في دكاترة متاحين للحجز حالياً، تواصل مع العيادة.</Alert>
      ) : (
        <>
          {data.doctors.length > 1 && (
            <Card title="1. اختر الدكتور">
              <div className="flex flex-wrap gap-2">
                {data.doctors.map((d) => (
                  <Choice
                    key={d.id}
                    selected={d.id === doctorId}
                    onClick={() => {
                      setDoctorId(d.id)
                      setDate('')
                      setSlot('')
                    }}
                  >
                    {d.fullName}
                    {d.specialty ? ` · ${d.specialty}` : ''}
                  </Choice>
                ))}
              </div>
            </Card>
          )}
          {doctorId && (
            <Card title={data.doctors.length > 1 ? '2. اختر اليوم' : '1. اختر اليوم'} hint={doctor ? `مع ${doctor.fullName}` : undefined}>
              {!days.data ? (
                <Loading error={days.error} />
              ) : days.data.days.length === 0 ? (
                <Alert tone="warning">ما في أيام متاحة قريباً مع هالدكتور.</Alert>
              ) : (
                groupByMonth(days.data.days).map((g) => (
                  <div key={g.month} className="flex flex-col gap-2">
                    <h3 className="text-sm font-bold text-muted">{monthTitle(g.month)}</h3>
                    <div className="flex flex-wrap gap-2">
                      {g.days.map((d) => (
                        <Choice
                          key={d.date}
                          selected={d.date === date}
                          onClick={() => {
                            setDate(d.date)
                            setSlot('')
                          }}
                        >
                          {dayOfMonth(d.date)}
                        </Choice>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </Card>
          )}
          {doctorId && date && (
            <Card title={data.doctors.length > 1 ? '3. اختر الوقت' : '2. اختر الوقت'} hint={dayTitle(date)}>
              {!slots.data ? (
                <Loading error={slots.error} />
              ) : slots.data.slots.length === 0 ? (
                <Alert tone="warning">انحجزت كل الأوقات بهاليوم، اختر يوم ثاني.</Alert>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {slots.data.slots.map((s) => (
                    <Choice key={s} selected={s === slot} onClick={() => setSlot(s)}>
                      <bdi dir="ltr">{timeLabel(s)}</bdi>
                    </Choice>
                  ))}
                </div>
              )}
            </Card>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          {slot && (
            <Card title="تأكيد">
              <p className="leading-8">
                {dayTitle(date)} · <bdi dir="ltr">{timeLabel(slot)}</bdi>
                <br />
                مع {doctor?.fullName}
              </p>
              <Button busy={busy} onClick={confirm}>
                {moving ? 'تأكيد التعديل' : 'تأكيد الحجز'}
              </Button>
            </Card>
          )}
        </>
      )}
      <Button variant="secondary" disabled={busy} onClick={onBack}>
        رجوع
      </Button>
    </div>
  )
}

/** The page a patient opens from WhatsApp. No login: the link itself carries his verified phone. */
export default function BookingPage() {
  const { token = '' } = useParams()
  const overview = useLoad(() => getOverview(token), [token])
  const [view, setView] = useState<View>({ name: 'home' })
  const data = overview.data

  return (
    <ThemeScope color={data?.clinic.themeColor} platform={!data}>
      <div className="min-h-screen bg-[#f6f8fa]">
        <header className="bg-brand px-4 py-5 text-on-brand">
          <div className="mx-auto flex max-w-xl items-center gap-3">
            {data?.clinic.logoUrl ? (
              <img src={assetUrl(data.clinic.logoUrl)} alt="" className="size-12 rounded-xl bg-white object-contain" />
            ) : (
              <span className="inline-flex size-12 items-center justify-center rounded-xl bg-on-brand text-2xl font-bold text-brand">{(data?.clinic.name ?? 'ع').charAt(0)}</span>
            )}
            <div className="flex flex-col leading-snug">
              <h1 className="text-xl font-bold">{data ? `عيادة ${data.clinic.name}` : 'حجز موعد'}</h1>
              <span className="text-sm text-on-brand-soft">حجز موعد أو استفسار عن موعدك</span>
            </div>
          </div>
        </header>
        <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
          {!data ? (
            <Loading error={overview.error} />
          ) : view.name === 'done' ? (
            <Card title={view.title}>
              <p className="leading-8 whitespace-pre-line">{view.line}</p>
              <Button
                onClick={() => {
                  setView({ name: 'home' })
                  overview.reload()
                }}
              >
                رجوع للرئيسية
              </Button>
            </Card>
          ) : view.name === 'register' ? (
            <Register
              token={token}
              onBack={() => setView({ name: 'home' })}
              onRegistered={(id, name) => {
                overview.reload()
                setView({ name: 'book', patientId: id, patientName: name })
              }}
            />
          ) : view.name === 'book' ? (
            <BookFlow
              token={token}
              data={data}
              patientId={view.patientId}
              patientName={view.patientName}
              moving={view.moving}
              onBack={() => setView({ name: 'home' })}
              onDone={(title, line) => setView({ name: 'done', title, line })}
            />
          ) : (
            <Home token={token} data={data} go={setView} reload={overview.reload} />
          )}
        </main>
      </div>
    </ThemeScope>
  )
}
