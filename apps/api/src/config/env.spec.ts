import { afterEach, describe, expect, it } from 'vitest';
import { getConfirmWindowHours } from './env.js';

describe('getConfirmWindowHours', () => {
  const saved = process.env.AUTO_CONFIRM_WINDOW_HOURS;
  afterEach(() => {
    if (saved === undefined) delete process.env.AUTO_CONFIRM_WINDOW_HOURS;
    else process.env.AUTO_CONFIRM_WINDOW_HOURS = saved;
  });
  it('is 24 hours by default (blank counts as not set)', () => {
    delete process.env.AUTO_CONFIRM_WINDOW_HOURS;
    expect(getConfirmWindowHours()).toBe(24);
    process.env.AUTO_CONFIRM_WINDOW_HOURS = '  ';
    expect(getConfirmWindowHours()).toBe(24);
  });
  it('can be set, 0 turns it off, junk is refused', () => {
    process.env.AUTO_CONFIRM_WINDOW_HOURS = '12';
    expect(getConfirmWindowHours()).toBe(12);
    process.env.AUTO_CONFIRM_WINDOW_HOURS = '0';
    expect(getConfirmWindowHours()).toBe(0);
    process.env.AUTO_CONFIRM_WINDOW_HOURS = 'abc';
    expect(() => getConfirmWindowHours()).toThrow();
  });
});
