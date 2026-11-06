import { describe, expect, it } from 'vitest'
import { buildWhatsappInput } from './whatsappForm.ts'

const f = (o: Partial<{ phoneNumberId: string; businessAccountId: string; accessToken: string }> = {}) => ({ phoneNumberId: '123456789012345', businessAccountId: '', accessToken: 'E'.repeat(30), ...o })

describe('WhatsApp number form', () => {
  it('accepts a full form and trims it', () => {
    expect(buildWhatsappInput(f({ phoneNumberId: ' 123456789012345 ', businessAccountId: '99887766' }), false)).toEqual({ input: { phoneNumberId: '123456789012345', businessAccountId: '99887766', accessToken: 'E'.repeat(30) } })
  })
  it('an empty business account id is sent as null', () => {
    expect(buildWhatsappInput(f(), false)).toMatchObject({ input: { businessAccountId: null } })
  })
  it('the token is required the first time but optional when one is saved', () => {
    expect('error' in buildWhatsappInput(f({ accessToken: '' }), false)).toBe(true)
    expect(buildWhatsappInput(f({ accessToken: '' }), true)).toEqual({ input: { phoneNumberId: '123456789012345', businessAccountId: null } })
  })
  it('refuses letters in the ids and a cut-off token', () => {
    expect('error' in buildWhatsappInput(f({ phoneNumberId: '12ab' }), false)).toBe(true)
    expect('error' in buildWhatsappInput(f({ businessAccountId: 'abc' }), false)).toBe(true)
    expect('error' in buildWhatsappInput(f({ accessToken: 'short' }), false)).toBe(true)
  })
})
