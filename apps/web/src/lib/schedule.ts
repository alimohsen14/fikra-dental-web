// Calendar math for the clinic's own wall clock. The API stores real instants (UTC) and working hours as
// "weekday + minutes since midnight" in the clinic's time zone, so everything here goes through that zone,
// never through the browser's (a secretary travelling abroad must still see the clinic's times).

export const CLINIC_TZ = 'Asia/Hebron'
export const SLOT_MINUTES = 30
export const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'] as const

const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: CLINIC_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export interface LocalParts {
  date: string // "2026-11-01"
  weekday: number // 0 = Sunday
  minute: number // minutes since local midnight
}

export function localParts(instant: Date | string): LocalParts {
  const p: Record<string, string> = {}
  for (const x of parts.formatToParts(new Date(instant))) p[x.type] = x.value
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: SHORT.indexOf(p.weekday ?? ''),
    minute: Number(p.hour) * 60 + Number(p.minute),
  }
}

const dayNumber = (date: string): number => Date.parse(`${date}T00:00:00Z`) / 86_400_000

export const addDays = (date: string, n: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay()
export const weekStart = (date: string): string => addDays(date, -weekdayOf(date))
export const todayDate = (now: Date = new Date()): string => localParts(now).date

/** A valid calendar day typed in a date field? ("2026-02-31" is not.) */
export const isDate = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v

/** The real instant at which the clinic's wall clock shows `minute` on `date`. Works across daylight-saving changes. */
export function instantAt(date: string, minute: number): Date {
  const want = dayNumber(date) * 1440 + minute
  let t = want * 60_000
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(t))
    t += (want - (dayNumber(p.date) * 1440 + p.minute)) * 60_000
  }
  return new Date(t)
}

/** [from, to) of one clinic day as ISO strings, for the API. */
export const dayRange = (date: string, days = 1): { from: string; to: string } => ({
  from: instantAt(date, 0).toISOString(),
  to: instantAt(addDays(date, days), 0).toISOString(),
})

export const minuteLabel = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
export const timeLabel = (instant: Date | string): string => minuteLabel(localParts(instant).minute)
export const dayTitle = (date: string): string => `${WEEKDAYS[weekdayOf(date)]} \u2066${date}\u2069` // the date is isolated so Arabic text does not flip it

export interface Period {
  weekday: number
  startMinute: number
  endMinute: number
}

export interface Busy {
  id?: string
  startsAt: string
  endsAt: string
  status: string
}

/**
 * Start times (minutes) the doctor can still be booked at on `date`: inside a working period, on the half-hour
 * grid, not overlapping a live appointment, and not in the past. Mirrors the API's rules (which have the last word).
 */
export function freeStarts(o: { date: string; periods: Period[]; busy: Busy[]; duration: number; now?: Date; ignoreId?: string }): number[] {
  const now = (o.now ?? new Date()).getTime()
  const live = o.busy.filter((b) => (b.status === 'PENDING' || b.status === 'CONFIRMED') && (o.ignoreId === undefined || b.id !== o.ignoreId))
  const out: number[] = []
  for (const p of o.periods) {
    if (p.weekday !== weekdayOf(o.date)) continue
    for (let s = p.startMinute; s + o.duration <= p.endMinute; s += SLOT_MINUTES) {
      const start = instantAt(o.date, s).getTime()
      const end = start + o.duration * 60_000
      if (start < now - 30 * 60_000) continue
      if (live.some((b) => Date.parse(b.startsAt) < end && Date.parse(b.endsAt) > start)) continue
      out.push(s)
    }
  }
  return out.sort((a, b) => a - b)
}

export type WeekRows = Record<number, { start: number; end: number }[]>

export const emptyWeek = (): WeekRows => ({ 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] })

export function weekFromPeriods(periods: Period[]): WeekRows {
  const w = emptyWeek()
  for (const p of periods) w[p.weekday]?.push({ start: p.startMinute, end: p.endMinute })
  for (const d of Object.keys(w)) w[Number(d)]!.sort((a, b) => a.start - b.start)
  return w
}

/** The editor's rows -> what the API wants, or an Arabic error message. */
export function periodsFromWeek(w: WeekRows): { ok: true; periods: Period[] } | { ok: false; error: string } {
  const periods: Period[] = []
  for (let d = 0; d < 7; d++) {
    const rows = [...(w[d] ?? [])].sort((a, b) => a.start - b.start)
    for (const [i, r] of rows.entries()) {
      if (r.end <= r.start) return { ok: false, error: `${WEEKDAYS[d]}: وقت النهاية لازم يكون بعد البداية` }
      if (i > 0 && r.start < rows[i - 1]!.end) return { ok: false, error: `${WEEKDAYS[d]}: فترتين متداخلتين` }
      periods.push({ weekday: d, startMinute: r.start, endMinute: r.end })
    }
  }
  return { ok: true, periods }
}
