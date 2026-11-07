import { describe, expect, it } from 'vitest';
import { paidTotal, periodRange, remainingOf } from './period.js';

describe('periodRange', () => {
  it('a day is that day', () => expect(periodRange('day', '2026-11-07')).toEqual({ from: '2026-11-07', to: '2026-11-08' }));
  it('the week starts on Saturday, whichever day inside it is asked for', () => {
    // 2026-11-07 is a Saturday
    for (const d of ['2026-11-07', '2026-11-08', '2026-11-10', '2026-11-13']) expect(periodRange('week', d)).toEqual({ from: '2026-11-07', to: '2026-11-14' });
    expect(periodRange('week', '2026-11-14')).toEqual({ from: '2026-11-14', to: '2026-11-21' });
    expect(periodRange('week', '2026-11-06')).toEqual({ from: '2026-10-31', to: '2026-11-07' }); // Friday belongs to the week before
  });
  it('a month, including December and short months', () => {
    expect(periodRange('month', '2026-11-17')).toEqual({ from: '2026-11-01', to: '2026-12-01' });
    expect(periodRange('month', '2026-12-31')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
    expect(periodRange('month', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-03-01' });
  });
  it('a year', () => expect(periodRange('year', '2026-06-15')).toEqual({ from: '2026-01-01', to: '2027-01-01' }));
});

describe('what is owed on a bill', () => {
  const p = (amount: number, status: 'ACTIVE' | 'VOIDED' = 'ACTIVE') => ({ amount, status });
  it('counts active payments only', () => {
    expect(paidTotal([p(100), p(50, 'VOIDED'), p(25)])).toBe(125);
    expect(remainingOf(500, [p(100), p(50, 'VOIDED')])).toBe(400);
  });
  it('never negative', () => expect(remainingOf(100, [p(150)])).toBe(0));
});
