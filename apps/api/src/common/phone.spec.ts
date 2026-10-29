import { normalizePhone } from './phone.js';

describe('normalizePhone', () => {
  it('normalizes the usual ways Palestinians write a mobile number', () => {
    for (const input of ['0599123456', '599123456', '+970599123456', '00970599123456', '970599123456',
      '059-912-3456', '+970 59 912 3456', '+970 (0)59 912 3456']) {
      expect(normalizePhone(input)).toBe('+970599123456');
    }
  });

  it('keeps Israeli numbers when the country code is explicit', () => {
    expect(normalizePhone('+972521234567')).toBe('+972521234567');
    expect(normalizePhone('00972521234567')).toBe('+972521234567');
  });

  it('accepts a landline', () => {
    expect(normalizePhone('022345678')).toBe('+97022345678');
  });

  it('accepts other countries only with an explicit +', () => {
    expect(normalizePhone('+962791234567')).toBe('+962791234567');
  });

  it('rejects garbage', () => {
    for (const input of ['', 'abc', '123', '+970', '05991', '+9705991234567890', '059912x456']) {
      expect(normalizePhone(input)).toBeNull();
    }
  });
});
