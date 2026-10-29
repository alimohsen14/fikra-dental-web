// Normalizes phone numbers to international format (+9705...). Default country is Palestine (+970);
// Israel (+972) is supported. Returns null when the number cannot be valid.
export function normalizePhone(input: string): string | null {
  const raw = input.trim().replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(raw)) return null;

  let digits: string;
  if (raw.startsWith('+')) digits = raw.slice(1);
  else if (raw.startsWith('00')) digits = raw.slice(2);
  else if (raw.startsWith('0')) digits = '970' + raw.slice(1); // local number, e.g. 0599123456
  else if (raw.startsWith('970') || raw.startsWith('972')) digits = raw;
  else digits = '970' + raw; // e.g. 599123456

  // Some people write +970 (0)59...: drop the extra local zero after the country code.
  digits = digits.replace(/^(970|972)0/, '$1');

  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  if ((digits.startsWith('970') || digits.startsWith('972')) && ![11, 12].includes(digits.length)) {
    return null;
  }
  return '+' + digits;
}
