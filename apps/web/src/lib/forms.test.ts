import { describe, expect, it } from 'vitest'
import type { ClinicRow } from './admin.ts'
import { buildCreateInput, buildPaymentInput, endedNote } from './forms.ts'

const good = { name: ' عيادة البسمة ', ownerName: 'د. سامر', username: ' Owner_Basma ', phone: '', specialty: '', months: 12, price: '3,000' }

describe('buildCreateInput', () => {
  it('builds the request: trimmed, lowercase username, price in agorot, empty optionals left out', () => {
    expect(buildCreateInput(good)).toEqual({
      input: { name: 'عيادة البسمة', subscription: { months: 12, price: 300000 }, owner: { fullName: 'د. سامر', username: 'owner_basma' } },
    })
  })

  it('never sends a theme color (it belongs to the clinic), and keeps phone/specialty when given', () => {
    const r = buildCreateInput({ ...good, phone: '0599123456', specialty: 'طب أسنان عام' })
    expect(r).toMatchObject({ input: { owner: { phone: '0599123456', specialty: 'طب أسنان عام' } } })
    expect('themeColor' in (r as { input: object }).input).toBe(false)
  })

  it('rejects bad names, usernames and prices with a message', () => {
    for (const bad of [{ name: 'ع' }, { ownerName: '' }, { username: 'ab' }, { username: 'bad name' }, { username: 'عربي_user' }, { price: '' }, { price: 'abc' }, { phone: '12' }]) {
      expect(buildCreateInput({ ...good, ...bad })).toHaveProperty('error')
    }
  })

  it('a price of 0 is allowed (free term)', () => {
    expect(buildCreateInput({ ...good, price: '0' })).toMatchObject({ input: { subscription: { price: 0 } } })
  })
})

describe('buildPaymentInput', () => {
  const f = { amount: '500', day: '', periodId: 'p1', note: '  تحويل  ' }
  it('builds the body in agorot', () => {
    expect(buildPaymentInput(f, 100000)).toEqual({ input: { amount: 50000, periodId: 'p1', note: 'تحويل' } })
  })
  it('accepts exactly the remaining amount but not more', () => {
    expect(buildPaymentInput({ ...f, amount: '1000' }, 100000)).toHaveProperty('input')
    expect(buildPaymentInput({ ...f, amount: '1000.01' }, 100000)).toHaveProperty('error')
  })
  it('rejects empty, zero and non-numbers', () => {
    for (const amount of ['', '0', 'x', '-5']) expect(buildPaymentInput({ ...f, amount }, 100000)).toHaveProperty('error')
  })
  it('sends paidAt only when a day is picked', () => {
    expect(buildPaymentInput({ ...f, day: '2020-01-02' }, 100000)).toMatchObject({ input: { paidAt: expect.any(String) } })
  })
})

describe('endedNote', () => {
  const base = { daysSinceEnd: 0, graceDaysLeft: 3 } as ClinicRow
  it('grace period shows days left; expired says login is closed', () => {
    expect(endedNote({ ...base, state: 'GRACE', daysSinceEnd: 1, graceDaysLeft: 2 }).text).toBe('انتهى قبل يوم واحد، باقي يومان للمهلة')
    expect(endedNote({ ...base, state: 'GRACE' }).text).toBe('انتهى اليوم، باقي 3 أيام للمهلة')
    expect(endedNote({ ...base, state: 'EXPIRED', daysSinceEnd: 5 }).text).toBe('انتهى قبل 5 أيام، الدخول مقفول')
  })
})
