import type { MonthRow } from './expenses.ts'

/** The month with the highest profit, only when it actually made money. */
export function bestMonth(rows: MonthRow[]): MonthRow | null {
  const best = rows.reduce<MonthRow | null>((b, r) => (b === null || r.profit > b.profit ? r : b), null)
  return best && best.profit > 0 ? best : null
}

/** Average profit per month, whole agorot. 0 for no months. */
export const averageProfit = (rows: MonthRow[]): number => (rows.length === 0 ? 0 : Math.round(rows.reduce((t, r) => t + r.profit, 0) / rows.length))

export interface Bar {
  month: string
  profit: number
  /** Where the bar starts and how tall it is, in percent of the plot height (from the top). */
  topPct: number
  heightPct: number
}
export interface Tick {
  value: number
  topPct: number
}

/** A round step (1, 2, 5 x 10^n shekels) so that about `want` steps cover `range` agorot. */
export function niceStep(range: number, want = 4): number {
  const raw = Math.max(range, 1) / 100 / want
  const pow = 10 ** Math.floor(Math.log10(raw))
  const f = raw / pow
  const base = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  return Math.max(base * pow, 1) * 100
}

/**
 * Bars on one shared zero line, with round gridline values. Profit goes up from the zero line, loss goes
 * down, so a loss month is never cut off. Every month in `rows` gets a column, even a month with nothing.
 */
export function layoutBars(rows: MonthRow[]): { zeroPct: number; bars: Bar[]; ticks: Tick[] } {
  const up = Math.max(0, ...rows.map((r) => r.profit))
  const down = Math.max(0, ...rows.map((r) => -r.profit))
  const step = niceStep(up + down)
  const maxTick = up === 0 && down === 0 ? step : Math.ceil(up / step) * step
  const minTick = -Math.ceil(down / step) * step
  const total = maxTick - minTick
  const pct = (v: number) => ((maxTick - v) / total) * 100
  const ticks: Tick[] = []
  for (let v = minTick; v <= maxTick; v += step) ticks.push({ value: v, topPct: pct(v) })
  return {
    zeroPct: pct(0),
    ticks,
    bars: rows.map((r) => {
      const h = (Math.abs(r.profit) / total) * 100
      return { month: r.month, profit: r.profit, topPct: r.profit >= 0 ? pct(0) - h : pct(0), heightPct: h }
    }),
  }
}

/** 400000 -> "4,000"; 50 -> "0.5"; no currency sign, for small chart labels. */
export function shortShekels(agorot: number): string {
  return (agorot / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })
}
