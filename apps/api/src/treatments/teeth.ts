/** FDI tooth numbering: permanent 11-18, 21-28, 31-38, 41-48; baby teeth 51-55, 61-65, 71-75, 81-85. */
export function isValidTooth(code: number): boolean {
  if (!Number.isInteger(code)) return false;
  const quadrant = Math.floor(code / 10);
  const position = code % 10;
  if (quadrant >= 1 && quadrant <= 4) return position >= 1 && position <= 8;
  if (quadrant >= 5 && quadrant <= 8) return position >= 1 && position <= 5;
  return false;
}
