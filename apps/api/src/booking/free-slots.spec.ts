import { describe, expect, it } from 'vitest';
import { instantAt, localDate, localTime } from '../scheduling/clinic-time.js';
import { daysWithFreeTime, freeSlots } from './free-slots.js';

const TZ = 'Asia/Hebron';
const H = (h: number, m = 0) => h * 60 + m;
// 2026-11-10 is a Tuesday (weekday 2)
const periods = [{ weekday: 2, startMinute: H(9), endMinute: H(11) }, { weekday: 2, startMinute: H(16), endMinute: H(17) }];
const longBefore = new Date('2026-11-01T00:00:00Z');
const at = (d: string, m: number) => instantAt(d, m, TZ);

describe('instantAt / localDate', () => {
  it('round-trips with the clinic wall clock, winter and summer', () => {
    for (const d of ['2026-11-10', '2026-07-10', '2026-03-27', '2026-10-24']) {
      const i = instantAt(d, H(10, 30), TZ);
      expect(localTime(i, TZ).minute).toBe(H(10, 30));
      expect(localDate(i, TZ)).toBe(d);
    }
    expect(instantAt('2026-11-10', H(10), TZ).toISOString()).toBe('2026-11-10T08:00:00.000Z'); // UTC+2 in winter
  });
});

describe('free slots for one day', () => {
  it('lists every half hour of both working periods', () => {
    const s = freeSlots({ date: '2026-11-10', timeZone: TZ, periods, busy: [], duration: 30, now: longBefore });
    expect(s.map((d) => localTime(d, TZ).minute)).toEqual([H(9), H(9, 30), H(10), H(10, 30), H(16), H(16, 30)]);
  });
  it('a 60-minute visit needs the whole hour to fit', () => {
    const s = freeSlots({ date: '2026-11-10', timeZone: TZ, periods, busy: [], duration: 60, now: longBefore });
    expect(s.map((d) => localTime(d, TZ).minute)).toEqual([H(9), H(9, 30), H(10), H(16)]);
  });
  it('a busy appointment blocks every slot it overlaps, and nothing else', () => {
    const busy = [{ startsAt: at('2026-11-10', H(9, 30)), endsAt: at('2026-11-10', H(10, 30)) }];
    const s = freeSlots({ date: '2026-11-10', timeZone: TZ, periods, busy, duration: 30, now: longBefore });
    expect(s.map((d) => localTime(d, TZ).minute)).toEqual([H(9), H(10, 30), H(16), H(16, 30)]);
  });
  it('times that already began are not offered; a day without hours has none', () => {
    const now = at('2026-11-10', H(9, 30));
    const s = freeSlots({ date: '2026-11-10', timeZone: TZ, periods, busy: [], duration: 30, now });
    expect(localTime(s[0]!, TZ).minute).toBe(H(10));
    expect(freeSlots({ date: '2026-11-11', timeZone: TZ, periods, busy: [], duration: 30, now: longBefore })).toEqual([]);
  });
});

describe('days that have free time', () => {
  it('skips days off and fully booked days', () => {
    const busy = [{ startsAt: at('2026-11-17', H(9)), endsAt: at('2026-11-17', H(11)) }, { startsAt: at('2026-11-17', H(16)), endsAt: at('2026-11-17', H(17)) }];
    const d = daysWithFreeTime({ timeZone: TZ, periods, busy, duration: 30, now: new Date('2026-11-09T06:00:00Z'), days: 21 });
    expect(d.map((x) => x.date)).toEqual(['2026-11-10', '2026-11-24']);
    expect(d[0]!.count).toBe(6);
  });
});
