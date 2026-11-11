// Display helpers. Western digits everywhere (decided for the whole app). Money is kept in agorot (integers).

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const MAX_AGOROT = 100_000_000 // same limit as the API

/** "2026-10-31" or "-" when empty/invalid. */
export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return '-'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('en-CA')
}

/** 15000 -> "₪150", 15050 -> "₪150.50" */
export function formatMoney(agorot: number): string {
  const whole = agorot % 100 === 0
  return '₪' + (agorot / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })
}

/** What the person typed ("150", "150.5", "١٥٠") -> agorot, or null when it is not a valid amount. */
export function parseShekels(input: string): number | null {
  const t = input
    .trim()
    .replace(/,/g, '')
    .replace(/[٠-٩]/g, (c) => String(ARABIC_DIGITS.indexOf(c)))
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null
  const [whole = '0', frac = ''] = t.split('.')
  const agorot = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  return agorot > MAX_AGOROT ? null : agorot
}

/** A day picked in a date field -> an ISO time at the END of that local day (for subscription end dates). */
export const endOfDayIso = (day: string): string => new Date(`${day}T23:59:59`).toISOString()

/** A day picked as "paid on" -> noon that day, but never in the future (the API refuses future payments). */
export function paidAtIso(day: string): string {
  const d = new Date(`${day}T12:00:00`)
  return (d.getTime() > Date.now() ? new Date() : d).toISOString()
}

export const todayInput = (): string => new Date().toLocaleDateString('en-CA')

/** Money and treatment dates never go forward (only appointments may). */
export const FUTURE_DAY_ERROR = 'لا يمكن التسجيل بتاريخ في المستقبل'
export const isFutureDay = (day: string): boolean => day > todayInput()

/** A date column from the API ("1994-06-21T00:00:00.000Z") -> "1994-06-21", never shifted by the time zone. */
export const dateOnly = (v: string | null | undefined): string => (v ? v.slice(0, 10) : '-')

/** Whole years between a birth date ("YYYY-MM-DD…") and a day; null when there is no usable birth date. */
export function ageInYears(birthDate: string | null | undefined, today: string): number | null {
  if (!birthDate) return null
  const [by, bm, bd] = birthDate.slice(0, 10).split('-').map(Number)
  const [ty, tm, td] = today.slice(0, 10).split('-').map(Number)
  if (![by, bm, bd, ty, tm, td].every(Number.isFinite)) return null
  let age = ty - by
  if (tm < bm || (tm === bm && td < bd)) age -= 1
  return age < 0 ? null : age
}

export function ageLabel(birthDate: string | null | undefined, today: string): string {
  const age = ageInYears(birthDate, today)
  if (age === null) return '-'
  if (age < 1) return 'أقل من سنة'
  if (age === 1) return 'سنة'
  if (age === 2) return 'سنتان'
  return `${age} ${age <= 10 ? 'سنوات' : 'سنة'}`
}
