import { moneyOf, paidTotal, shouldClose } from './money.js';
import { isValidTooth } from './teeth.js';

describe('FDI tooth codes', () => {
  it('accepts permanent and baby teeth', () => {
    for (const c of [11, 18, 21, 28, 31, 38, 41, 48, 51, 55, 61, 65, 71, 75, 81, 85]) expect(isValidTooth(c)).toBe(true);
  });
  it('refuses numbers that are not a tooth', () => {
    for (const c of [0, 10, 19, 29, 49, 56, 66, 76, 86, 90, 111, -11, 11.5, Number.NaN]) expect(isValidTooth(c)).toBe(false);
  });
});

describe('treatment money', () => {
  const pay = (amount: number, status: 'ACTIVE' | 'VOIDED' = 'ACTIVE') => ({ amount, status });
  it('voided payments never count', () => {
    expect(paidTotal([pay(100), pay(500, 'VOIDED'), pay(50)])).toBe(150);
    expect(moneyOf(1000, [pay(100), pay(500, 'VOIDED')])).toEqual({ paid: 100, remaining: 900 });
  });
  it('the remaining amount never goes below zero', () => {
    expect(moneyOf(100, [pay(100)])).toEqual({ paid: 100, remaining: 0 });
  });
  it('closes only when fully paid AND every session is done', () => {
    const done = [{ status: 'COMPLETED' as const }, { status: 'COMPLETED' as const }];
    const half = [{ status: 'COMPLETED' as const }, { status: 'PLANNED' as const }];
    expect(shouldClose(100, [pay(100)], done)).toBe(true);
    expect(shouldClose(100, [pay(90)], done)).toBe(false);
    expect(shouldClose(100, [pay(100)], half)).toBe(false);
    expect(shouldClose(100, [pay(100, 'VOIDED')], done)).toBe(false);
    expect(shouldClose(0, [], done)).toBe(true); // a free treatment
    expect(shouldClose(0, [], [])).toBe(false);
  });
});
