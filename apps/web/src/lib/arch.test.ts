import { describe, expect, it } from 'vitest'
import { archFor, archType } from './arch.ts'

/** Same rule as the API (apps/api/src/treatments/teeth.ts): FDI codes only. */
function isValidFdi(code: number): boolean {
  const quadrant = Math.floor(code / 10)
  const pos = code % 10
  if (quadrant >= 1 && quadrant <= 4) return pos >= 1 && pos <= 8
  if (quadrant >= 5 && quadrant <= 8) return pos >= 1 && pos <= 5
  return false
}

describe('arch geometry', () => {
  it('draws every tooth once: 32 permanent, 20 baby', () => {
    const adult = archFor('adult').teeth.map((t) => t.code)
    const kids = archFor('kids').teeth.map((t) => t.code)
    expect(adult).toHaveLength(32)
    expect(new Set(adult).size).toBe(32)
    expect(kids).toHaveLength(20)
    expect(new Set(kids).size).toBe(20)
    expect([...adult, ...kids].every(isValidFdi)).toBe(true)
  })

  it("the patient's right is on the viewer's left, and the two sides mirror each other", () => {
    const t = (code: number) => archFor('adult').teeth.find((x) => x.code === code)!
    expect(t(18).cx).toBeLessThan(t(11).cx)
    expect(t(11).cx).toBeLessThan(400)
    expect(t(21).cx).toBeGreaterThan(400)
    for (const [a, b] of [[11, 21], [16, 26], [18, 28], [41, 31], [46, 36], [48, 38]] as const) {
      expect(Math.abs(t(a).cx + t(b).cx - 800)).toBeLessThan(8)
      expect(Math.abs(t(a).cy - t(b).cy)).toBeLessThan(8)
    }
    const k = (code: number) => archFor('kids').teeth.find((x) => x.code === code)!
    expect(k(55).cx).toBeLessThan(k(51).cx)
    expect(k(61).cx).toBeGreaterThan(400)
  })

  it('upper teeth sit above the lower ones', () => {
    const { teeth } = archFor('adult')
    const front = (c: number) => teeth.find((t) => t.code === c)!.cy
    expect(front(11)).toBeLessThan(front(41))
  })

  it('neighbours never overlap and tap areas stay inside the drawing', () => {
    for (const set of ['adult', 'kids'] as const) {
      const a = archFor(set)
      const [vx, vy, vw, vh] = a.viewBox
      for (const t of a.teeth) {
        expect(t.hit.cx - t.hit.r).toBeGreaterThanOrEqual(vx)
        expect(t.hit.cx + t.hit.r).toBeLessThanOrEqual(vx + vw)
        expect(t.hit.cy - t.hit.r).toBeGreaterThanOrEqual(vy)
        expect(t.hit.cy + t.hit.r).toBeLessThanOrEqual(vy + vh)
      }
      for (const jaw of [a.teeth.slice(0, a.teeth.length / 2), a.teeth.slice(a.teeth.length / 2)]) {
        for (let i = 1; i < jaw.length; i++) {
          const p = jaw[i - 1]!
          const q = jaw[i]!
          expect(Math.hypot(p.cx - q.cx, p.cy - q.cy)).toBeGreaterThan((Math.min(p.w, q.w) / 2 + Math.min(p.w, q.w) / 2) * 0.8)
        }
      }
    }
  })

  it('tooth shapes follow the tooth: incisors, canines, premolars, molars; baby molars look like molars', () => {
    expect([11, 12, 13, 14, 15, 16, 17, 18].map(archType)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect([51, 52, 53, 54, 55].map(archType)).toEqual([1, 2, 3, 6, 7])
  })
})
