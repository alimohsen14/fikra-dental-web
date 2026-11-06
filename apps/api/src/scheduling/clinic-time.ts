// Working hours are stored as "weekday + minutes from midnight" in the CLINIC's local time, while
// appointments are stored as exact instants (UTC). These helpers convert an instant to local time.

export interface LocalTime {
  weekday: number; // 0 = Sunday ... 6 = Saturday (same as the DoctorWorkingPeriod column)
  minute: number; // minutes from local midnight, 0..1439
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatters.set(timeZone, f);
  }
  return f;
}

export function localTime(instant: Date, timeZone: string): LocalTime {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return { weekday: WEEKDAYS[get('weekday')]!, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** The calendar day ("2026-11-10") the instant falls on in the clinic. */
export function localDate(instant: Date, timeZone: string): string {
  let f = dateFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dateFormatters.set(timeZone, f);
  }
  return f.format(instant);
}

/** Offset of the zone from UTC at that instant, in minutes. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const get = (type: string) => Number(f.formatToParts(instant).find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - Math.floor(instant.getTime() / 60_000) * 60_000) / 60_000);
}

/** The exact instant at which the clinic's wall clock shows `minute` on `date` (handles daylight saving). */
export function instantAt(date: string, minute: number, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, 0, minute);
  const first = wall - offsetMinutes(new Date(wall), timeZone) * 60_000;
  return new Date(wall - offsetMinutes(new Date(first), timeZone) * 60_000);
}

/** 0 = Sunday ... 6 = Saturday for a calendar day. */
export const weekdayOfDate = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();
export const addDaysTo = (date: string, n: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
