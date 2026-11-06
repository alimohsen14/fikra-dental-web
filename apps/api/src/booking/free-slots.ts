import { addDaysTo, instantAt, localDate, weekdayOfDate } from '../scheduling/clinic-time.js';

const MINUTE = 60_000;
export const SLOT_STEP = 30;

export interface Period {
  weekday: number;
  startMinute: number;
  endMinute: number;
}
export interface Busy {
  startsAt: Date;
  endsAt: Date;
}

/** Start times a patient may pick on one day: on the half-hour grid, inside working hours, not in the past, not on top of another appointment. */
export function freeSlots(o: { date: string; timeZone: string; periods: Period[]; busy: Busy[]; duration: number; now: Date }): Date[] {
  const out: Date[] = [];
  const weekday = weekdayOfDate(o.date);
  for (const p of o.periods) {
    if (p.weekday !== weekday) continue;
    for (let s = p.startMinute; s + o.duration <= p.endMinute; s += SLOT_STEP) {
      const start = instantAt(o.date, s, o.timeZone);
      const end = new Date(start.getTime() + o.duration * MINUTE);
      if (start.getTime() <= o.now.getTime()) continue; // a patient booking himself never books a time that already began
      if (o.busy.some((b) => b.startsAt < end && b.endsAt > start)) continue;
      out.push(start);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** The next `days` calendar days (starting today) that still have at least one free time. */
export function daysWithFreeTime(o: { timeZone: string; periods: Period[]; busy: Busy[]; duration: number; now: Date; days: number }): { date: string; count: number }[] {
  const today = localDate(o.now, o.timeZone);
  const out: { date: string; count: number }[] = [];
  for (let i = 0; i < o.days; i++) {
    const date = addDaysTo(today, i);
    const count = freeSlots({ ...o, date }).length;
    if (count > 0) out.push({ date, count });
  }
  return out;
}
