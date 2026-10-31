import { describe, expect, it } from 'vitest'
import { checkNewPassword } from './password.ts'

describe('checkNewPassword', () => {
  it('rejects short, same-as-current and mismatching passwords', () => {
    expect(checkNewPassword('old-pass-123', 'short', 'short')).toMatch(/10/)
    expect(checkNewPassword('same-pass-123', 'same-pass-123', 'same-pass-123')).toMatch(/تختلف/)
    expect(checkNewPassword('old-pass-123', 'new-pass-1234', 'new-pass-9999')).toMatch(/تأكيد/)
  })
  it('accepts a good one', () => {
    expect(checkNewPassword('old-pass-123', 'new-pass-1234', 'new-pass-1234')).toBeNull()
  })
})
