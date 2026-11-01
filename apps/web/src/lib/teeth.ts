// Teeth are STORED with FDI codes: permanent 11-18, 21-28, 31-38, 41-48; baby 51-55, 61-65, 71-75, 81-85.
// They are SHOWN with the universal numbering the clinic knows: permanent 1-32, baby teeth A-T.
// Charts are drawn the way the dentist looks at the patient: the patient's right side is on the viewer's left.

export type ToothSet = 'adult' | 'kids' | 'both'

const range = (from: number, to: number): number[] => (from <= to ? Array.from({ length: to - from + 1 }, (_, i) => from + i) : Array.from({ length: from - to + 1 }, (_, i) => from - i))

export const ADULT_UPPER = [...range(18, 11), ...range(21, 28)]
export const ADULT_LOWER = [...range(48, 41), ...range(31, 38)]
export const KIDS_UPPER = [...range(55, 51), ...range(61, 65)]
export const KIDS_LOWER = [...range(85, 81), ...range(71, 75)]

export const isBabyTooth = (code: number): boolean => code >= 51

/** Full years between the birth date ("1994-06-21" or an ISO time) and `now`; null when unknown. */
export function ageInYears(birthDate: string | null | undefined, now: Date = new Date()): number | null {
  if (!birthDate) return null
  const [y, m, d] = birthDate.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  let age = now.getFullYear() - y
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1
  return age < 0 ? null : age
}

/** Under 6: baby teeth. 6 to 12: both (mixed dentition). Older, or unknown age: permanent teeth. */
export function defaultSet(birthDate: string | null | undefined, now: Date = new Date()): ToothSet {
  const age = ageInYears(birthDate, now)
  if (age === null) return 'adult'
  if (age < 6) return 'kids'
  if (age <= 12) return 'both'
  return 'adult'
}

/** Which set shows the teeth of an existing treatment. */
export function setOfTeeth(codes: number[]): ToothSet {
  const baby = codes.some(isBabyTooth)
  const permanent = codes.some((c) => !isBabyTooth(c))
  return baby && permanent ? 'both' : baby ? 'kids' : 'adult'
}

const BABY_LETTERS = 'ABCDEFGHIJKLMNOPQRST'

/** Position of a tooth in the universal numbering: permanent 0-31 (tooth 1 is 0), baby 32-51 (A is 32). Also the sort order of the chart. */
export function toothOrder(code: number): number {
  const quadrant = Math.floor(code / 10)
  const pos = code % 10
  switch (quadrant) {
    case 1: return 9 - pos - 1 // 18 -> tooth 1
    case 2: return 8 + pos - 1 // 21 -> tooth 9
    case 3: return 25 - pos - 1 // 38 -> tooth 17
    case 4: return 24 + pos - 1 // 41 -> tooth 25
    case 5: return 32 + (5 - pos) // 55 -> A
    case 6: return 32 + 4 + pos // 61 -> F
    case 7: return 32 + 15 - pos // 75 -> K
    default: return 32 + 14 + pos // 85 -> T
  }
}

/** What the clinic sees on a tooth: "16" (universal 1-32) or a letter "E" for baby teeth. FDI 16 is universal 3. */
export const toothLabel = (code: number): string => (isBabyTooth(code) ? BABY_LETTERS[toothOrder(code) - 32]! : String(toothOrder(code) + 1))

export const sortTeeth = (codes: number[]): number[] => [...codes].sort((a, b) => toothOrder(a) - toothOrder(b))

/** "1 · 3 · E" : the teeth the way the clinic reads them, in chart order. */
export const teethText = (codes: number[]): string => sortTeeth(codes).map(toothLabel).join(' · ')

export const toggleTooth = (list: number[], code: number): number[] => (list.includes(code) ? list.filter((c) => c !== code) : sortTeeth([...list, code]))

const SIDES = ['', 'علوي أيمن', 'علوي أيسر', 'سفلي أيسر', 'سفلي أيمن']

export type ToothKind = 'incisor' | 'canine' | 'premolar' | 'molar'
export function toothKind(code: number): ToothKind {
  const pos = code % 10
  if (pos <= 2) return 'incisor'
  if (pos === 3) return 'canine'
  if (isBabyTooth(code)) return 'molar' // baby teeth 4-5 are molars
  return pos <= 5 ? 'premolar' : 'molar'
}
const KIND_LABELS: Record<ToothKind, string> = { incisor: 'قاطع', canine: 'ناب', premolar: 'ضاحك', molar: 'ضرس' }

/** "3 · ضرس علوي أيمن" (universal number); baby teeth show a letter and "(لبني)". */
export function toothName(code: number): string {
  const quadrant = Math.floor(code / 10)
  const side = SIDES[quadrant > 4 ? quadrant - 4 : quadrant] ?? ''
  return `${toothLabel(code)} · ${KIND_LABELS[toothKind(code)]} ${side}${isBabyTooth(code) ? ' (لبني)' : ''}`
}
