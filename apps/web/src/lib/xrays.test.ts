import { describe, expect, it } from 'vitest'
import { fitWithin, sizeLabel, xrayFileError } from './xrays.ts'

describe('xrays helpers', () => {
  it('accepts only pictures', () => {
    expect(xrayFileError({ type: 'image/jpeg', size: 10 })).toBeNull()
    expect(xrayFileError({ type: 'image/png', size: 10 })).toBeNull()
    expect(xrayFileError({ type: 'application/pdf', size: 10 })).not.toBeNull()
    expect(xrayFileError({ type: 'image/svg+xml', size: 10 })).not.toBeNull()
  })
  it('shrinks big pictures keeping the shape, never enlarges', () => {
    expect(fitWithin(4800, 2400)).toEqual({ width: 2400, height: 1200 })
    expect(fitWithin(2400, 4800)).toEqual({ width: 1200, height: 2400 })
    expect(fitWithin(1000, 800)).toEqual({ width: 1000, height: 800 })
  })
  it('writes sizes for people', () => {
    expect(sizeLabel(300)).toBe('1 KB')
    expect(sizeLabel(512 * 1024)).toBe('512 KB')
    expect(sizeLabel(3.5 * 1024 * 1024)).toBe('3.5 MB')
  })
})
