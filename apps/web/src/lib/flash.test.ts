import { describe, expect, it } from 'vitest'
import { flashOf, flashState } from './flash.ts'

describe('flash banner', () => {
  it('round-trips what a save leaves for the next page', () => {
    expect(flashOf(flashState('تم الحفظ'))).toEqual({ message: 'تم الحفظ', tone: 'success' })
    expect(flashOf(flashState('انتبه', 'warning'))).toEqual({ message: 'انتبه', tone: 'warning' })
  })
  it('ignores anything else', () => {
    expect(flashOf(null)).toBeNull()
    expect(flashOf({})).toBeNull()
    expect(flashOf({ flash: { message: '' } })).toBeNull()
    expect(flashOf({ flash: { message: 5 } })).toBeNull()
    expect(flashOf({ created: true })).toBeNull()
  })
})
