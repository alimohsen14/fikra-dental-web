import { checkClinicAccess, GRACE_DAYS } from './clinic-access.js';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-10T12:00:00Z');
const clinic = (endsOffsetDays: number | null, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') => ({
  status,
  subscriptionEndsAt: endsOffsetDays === null ? null : new Date(now.getTime() + endsOffsetDays * DAY),
});

describe('checkClinicAccess', () => {
  it('always allows users without a clinic (platform admin)', () => {
    expect(checkClinicAccess(null, now)).toEqual({ allowed: true, warning: null });
  });

  it('allows an active clinic with no end date, or a future end date, without a warning', () => {
    expect(checkClinicAccess(clinic(null), now)).toEqual({ allowed: true, warning: null });
    expect(checkClinicAccess(clinic(30), now)).toEqual({ allowed: true, warning: null });
    expect(checkClinicAccess(clinic(0), now)).toEqual({ allowed: true, warning: null });
  });

  it('warns during the 3 grace days after the subscription ended', () => {
    const r1 = checkClinicAccess(clinic(-0.5), now);
    expect(r1.allowed).toBe(true);
    expect(r1.allowed && r1.warning?.graceDaysLeft).toBe(3);

    const r2 = checkClinicAccess(clinic(-1.5), now);
    expect(r2.allowed && r2.warning?.graceDaysLeft).toBe(2);

    const r3 = checkClinicAccess(clinic(-2.9), now);
    expect(r3.allowed && r3.warning?.graceDaysLeft).toBe(1);
  });

  it(`blocks once more than ${GRACE_DAYS} days have passed`, () => {
    expect(checkClinicAccess(clinic(-GRACE_DAYS), now).allowed).toBe(true); // exactly at the limit
    expect(checkClinicAccess(clinic(-GRACE_DAYS - 0.01), now)).toEqual({
      allowed: false,
      reason: 'SUBSCRIPTION_EXPIRED',
    });
    expect(checkClinicAccess(clinic(-100), now).allowed).toBe(false);
  });

  it('blocks a suspended clinic even if the subscription is valid', () => {
    expect(checkClinicAccess(clinic(30, 'SUSPENDED'), now)).toEqual({
      allowed: false,
      reason: 'CLINIC_SUSPENDED',
    });
  });

  it('access returns when the subscription is renewed', () => {
    expect(checkClinicAccess(clinic(-10), now).allowed).toBe(false);
    expect(checkClinicAccess(clinic(365), now).allowed).toBe(true);
  });
});
