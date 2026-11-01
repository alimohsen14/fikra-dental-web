import { localTime } from './clinic-time.js';

describe('localTime (clinic time zone)', () => {
  it('winter: Asia/Hebron is UTC+2', () => {
    // Thursday 2026-01-15 07:00 UTC = 09:00 in Hebron
    expect(localTime(new Date('2026-01-15T07:00:00Z'), 'Asia/Hebron')).toEqual({ weekday: 4, minute: 540 });
  });

  it('summer: Asia/Hebron is UTC+3 (daylight saving)', () => {
    // Thursday 2026-07-16 06:00 UTC = 09:00 in Hebron
    expect(localTime(new Date('2026-07-16T06:00:00Z'), 'Asia/Hebron')).toEqual({ weekday: 4, minute: 540 });
  });

  it('the local weekday can differ from the UTC weekday', () => {
    // Thursday 22:30 UTC in winter is already Friday 00:30 in Hebron
    expect(localTime(new Date('2026-01-15T22:30:00Z'), 'Asia/Hebron')).toEqual({ weekday: 5, minute: 30 });
  });

  it('midnight is minute 0, not 1440', () => {
    expect(localTime(new Date('2026-01-14T22:00:00Z'), 'Asia/Hebron')).toEqual({ weekday: 4, minute: 0 });
  });
});
