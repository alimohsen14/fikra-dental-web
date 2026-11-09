import { describe, expect, it } from 'vitest'
import { yearSummary } from './myIncome.ts'

describe('yearSummary', () => {
  it('adds the months up and finds the best one', () => {
    const r = yearSummary([{ month: '2026-01', income: 100 }, { month: '2026-02', income: 500 }, { month: '2026-03', income: 0 }])
    expect(r).toEqual({ total: 600, best: { month: '2026-02', income: 500 } })
  })
  it('no income, no best month', () => {
    expect(yearSummary([{ month: '2026-01', income: 0 }])).toEqual({ total: 0, best: null })
    expect(yearSummary([])).toEqual({ total: 0, best: null })
  })
})
