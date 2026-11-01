// Geometry of the dental arch drawing: two U-shaped jaws, teeth placed along each curve by their real width.
// Ported from the first Fikra app (Flutter) so the chart looks the same; numbering here is FDI (what the API stores).
import { ADULT_LOWER, ADULT_UPPER, isBabyTooth, KIDS_LOWER, KIDS_UPPER } from './teeth.ts'

export type ArchSet = 'adult' | 'kids'

/** 1 central incisor, 2 lateral incisor, 3 canine, 4-5 premolars, 6-8 molars. Baby molars are drawn like molars. */
export function archType(code: number): number {
  const pos = code % 10
  if (isBabyTooth(code) && pos >= 4) return pos + 2 // baby first/second molar -> 6/7
  return pos
}

const WIDTH: Record<number, number> = { 1: 44, 2: 38, 3: 44, 4: 42, 5: 42, 6: 60, 7: 56, 8: 50 }
const DEPTH: Record<number, number> = { 1: 40, 2: 38, 3: 46, 4: 46, 5: 46, 6: 58, 7: 56, 8: 50 }
const THETA = (97 * Math.PI) / 180
const STEPS = 600

export interface ToothGeom {
  code: number
  type: number
  cx: number
  cy: number
  w: number
  d: number
  angle: number // degrees, clockwise
  lx: number // number label
  ly: number
  hit: { cx: number; cy: number; r: number } // invisible tap area: the tooth and its number
}

export interface Arch {
  teeth: ToothGeom[]
  gums: string[] // path of each jaw's gum band
  gumWidths: [number, number] // outer and inner stroke widths
  guides: { x1: number; y1: number; x2: number; y2: number }[]
  jawLabels: { text: string; x: number; y: number }[]
  viewBox: [number, number, number, number]
}

interface Jaw {
  order: number[]
  cy: number
  rx: number
  ry: number
  top: boolean
}

const PARAMS: Record<ArchSet, { upper: Jaw; lower: Jaw; labelUpper: number; labelLower: number }> = {
  adult: {
    upper: { order: ADULT_UPPER, cy: 360, rx: 215, ry: 225, top: true },
    lower: { order: ADULT_LOWER, cy: 540, rx: 215, ry: 200, top: false },
    labelUpper: 340,
    labelLower: 586,
  },
  kids: {
    upper: { order: KIDS_UPPER, cy: 345, rx: 165, ry: 165, top: true },
    lower: { order: KIDS_LOWER, cy: 505, rx: 165, ry: 145, top: false },
    labelUpper: 335,
    labelLower: 528,
  },
}

function place(jaw: Jaw): { teeth: ToothGeom[]; gum: string; front: number } {
  const { order, cy, rx, ry, top } = jaw
  const at = (t: number) => ({ x: 400 + rx * Math.sin(t), y: top ? cy - ry * Math.cos(t) : cy + ry * Math.cos(t) })

  const arc: number[] = [0]
  let prev = at(-THETA)
  for (let i = 1; i <= STEPS; i++) {
    const cur = at(-THETA + (2 * THETA * i) / STEPS)
    arc.push(arc[i - 1]! + Math.hypot(cur.x - prev.x, cur.y - prev.y))
    prev = cur
  }
  const length = arc[STEPS]!
  const total = order.reduce((sum, c) => sum + (WIDTH[archType(c)] ?? 44), 0)
  const k = (length * 0.99) / total

  let used = 0
  const teeth: ToothGeom[] = order.map((code) => {
    const type = archType(code)
    const w = (WIDTH[type] ?? 44) * k
    const d = (DEPTH[type] ?? 46) * k * 1.05
    const target = used + w / 2
    used += w
    let index = 0
    while (index < STEPS && arc[index]! < target + length * 0.005) index++
    const t = -THETA + (2 * THETA * index) / STEPS
    const c = at(t)
    const nx = Math.sin(t) / rx
    const ny = ((top ? -1 : 1) * Math.cos(t)) / ry
    const m = Math.hypot(nx, ny)
    const lx = c.x + (nx / m) * (d / 2 + 38)
    const ly = c.y + (ny / m) * (d / 2 + 38) + 5
    const mid = { x: (c.x + lx) / 2, y: (c.y + ly) / 2 }
    const r = Math.max(w / 2 + 3, Math.hypot(lx - c.x, ly - c.y) / 2 + 14)
    return { code, type, cx: c.x, cy: c.y, w, d, angle: (top ? 1 : -1) * ((t * 180) / Math.PI), lx, ly, hit: { cx: mid.x, cy: mid.y, r: Math.min(r, 36) } }
  })

  let gum = ''
  for (let i = 0; i <= 140; i++) {
    const p = at(-THETA + (2 * THETA * i) / 140)
    gum += `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`
  }
  return { teeth, gum, front: top ? cy - ry : cy + ry }
}

function build(set: ArchSet): Arch {
  const p = PARAMS[set]
  const up = place(p.upper)
  const lo = place(p.lower)
  const teeth = [...up.teeth, ...lo.teeth]

  const xs: number[] = []
  const ys: number[] = []
  for (const t of teeth) {
    const reach = Math.max(t.w, t.d) / 2 + 46 // the gum band reaches past the tooth
    xs.push(t.cx - reach, t.cx + reach, t.lx - 22, t.lx + 22)
    ys.push(t.cy - reach, t.cy + reach, t.ly - 22, t.ly + 14)
  }
  const x0 = Math.floor(Math.min(...xs))
  const y0 = Math.floor(Math.min(...ys)) - 14 // room for the "patient's right/left" captions
  const x1 = Math.ceil(Math.max(...xs))
  const y1 = Math.ceil(Math.max(...ys))

  const gapY = (p.upper.cy - p.upper.ry * Math.cos(THETA) + (p.lower.cy + p.lower.ry * Math.cos(THETA))) / 2
  return {
    teeth,
    gums: [up.gum, lo.gum],
    gumWidths: [84, 60],
    guides: [
      { x1: 400, y1: up.front - 50, x2: 400, y2: up.front + 80 },
      { x1: 400, y1: lo.front - 80, x2: 400, y2: lo.front + 50 },
      { x1: 272, y1: gapY, x2: 528, y2: gapY },
    ],
    jawLabels: [
      { text: 'الفك العلوي', x: 400, y: p.labelUpper },
      { text: 'الفك السفلي', x: 400, y: p.labelLower },
    ],
    viewBox: [x0, y0, x1 - x0, y1 - y0],
  }
}

const cache: Partial<Record<ArchSet, Arch>> = {}
export const archFor = (set: ArchSet): Arch => (cache[set] ??= build(set))
