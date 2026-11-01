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
