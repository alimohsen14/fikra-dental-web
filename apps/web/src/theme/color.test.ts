import { describe, expect, it } from 'vitest'
import { buildTheme, contrast, DEFAULT_CLINIC_COLOR, FIKRA_BLUE } from './color.ts'

describe('buildTheme', () => {
  it('uses white text on dark colors and dark text on light colors', () => {
    expect(buildTheme('#0b5d57')['--on-brand']).toBe('#ffffff')
    expect(buildTheme('#ffe066')['--on-brand']).toBe('#152437')
  })

  it('always gives readable text (contrast >= 4.5) for any color', () => {
    for (const c of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#808080', '#0560c8', '#f5a623']) {
      const t = buildTheme(c)
      expect(contrast(t['--on-brand']!, t['--brand']!)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('falls back to the default color for missing or invalid values', () => {
    for (const bad of [null, undefined, '', 'red', '#fff', '#12345g', 'javascript:alert(1)']) {
      expect(buildTheme(bad)['--brand']).toBe(DEFAULT_CLINIC_COLOR)
    }
  })

  it('uses the given fallback (Fikra blue for the platform)', () => {
    expect(buildTheme(null, FIKRA_BLUE)['--brand']).toBe(FIKRA_BLUE)
  })
})
