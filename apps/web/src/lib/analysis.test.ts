import { describe, expect, it } from 'vitest'
import { averageProfit, bestMonth, layoutBars, niceStep, shortShekels } from './analysis.ts'
import type { MonthRow } from './expenses.ts'

const row = (month: string, profit: number): MonthRow => ({ month, income: Math.max(profit, 0), expensesPaid: Math.max(-profit, 0), salariesPaid: 0, profit })

describe('bestMonth', () => {
  it('the month with the highest profit', () => {
    expect(bestMonth([row('2026-09', 100), row('2026-10', 500), row('2026-11', 300)])?.month).toBe('2026-10')
  })
  it('nobody is "best" when nothing made money', () => {
    expect(bestMonth([row('2026-09', -100), row('2026-10', 0)])).toBeNull()
    expect(bestMonth([])).toBeNull()
  })
})

describe('averageProfit', () => {
  it('averages including loss months', () => {
    expect(averageProfit([row('a', 300), row('b', -100)])).toBe(100)
    expect(averageProfit([])).toBe(0)
  })
})

describe('niceStep', () => {
  it('rounds to 1, 2 or 5 times a power of ten (in agorot)', () => {
    expect(niceStep(400000)).toBe(100000) // 4000 shekels over 4 steps -> 1000
    expect(niceStep(700000)).toBe(200000)
    expect(niceStep(1_800_000)).toBe(500000)
    expect(niceStep(0)).toBeGreaterThan(0)
  })
})

describe('layoutBars', () => {
  it('profits rise from the zero line, losses hang below it, on one scale', () => {
    const { zeroPct, bars } = layoutBars([row('a', 300000), row('b', -100000)])
    expect(zeroPct).toBeGreaterThan(50)
    expect(bars[0]!.topPct + bars[0]!.heightPct).toBeCloseTo(zeroPct)
    expect(bars[1]!.topPct).toBeCloseTo(zeroPct)
    expect(bars[0]!.heightPct / bars[1]!.heightPct).toBeCloseTo(3)
  })
  it('gridlines are round values and include zero', () => {
    const { ticks } = layoutBars([row('a', 400000), row('b', -100000)])
    expect(ticks.map((t) => t.value)).toContain(0)
    expect(ticks.every((t) => t.value % 100000 === 0)).toBe(true)
    expect(ticks[0]!.topPct).toBeCloseTo(100) // lowest value at the bottom
    expect(ticks[ticks.length - 1]!.topPct).toBeCloseTo(0)
  })
  it('only profits: zero line at the bottom', () => {
    expect(layoutBars([row('a', 200000), row('b', 100000)]).zeroPct).toBeCloseTo(100)
  })
  it('only losses: zero line at the top', () => {
    expect(layoutBars([row('a', -200000)]).zeroPct).toBeCloseTo(0)
  })
  it('every month keeps its column, empty months are flat; all zero does not divide by zero', () => {
    const { bars, ticks } = layoutBars([row('a', 0), row('b', 0)])
    expect(bars).toHaveLength(2)
    expect(bars.every((b) => b.heightPct === 0)).toBe(true)
    expect(ticks.length).toBeGreaterThan(0)
  })
})

describe('shortShekels', () => {
  it('plain number with separators', () => {
    expect(shortShekels(400000)).toBe('4,000')
    expect(shortShekels(-355000)).toBe('-3,550')
    expect(shortShekels(50)).toBe('0.5')
  })
})
