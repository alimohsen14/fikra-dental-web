import { describe, expect, it } from 'vitest'
import { buildChequeCreate, buildChequeUpdate, emptyChequeForm, filterQuery, formOfCheque, missingOf } from './cheques.ts'
import type { ChequeRow } from './cheques.ts'

const form = (over: Partial<ReturnType<typeof emptyChequeForm>> = {}) => ({ ...emptyChequeForm(), ...over })

describe('buildChequeCreate', () => {
  it('sends only the boxes that were filled; amount in agorot', () => {
    expect(buildChequeCreate(form({ amount: '300', dueDate: '2026-12-01', chequeNumber: ' 1234 ', bankName: '' }), 100_000)).toEqual({ body: { amount: 30_000, dueDate: '2026-12-01', chequeNumber: '1234' } })
  })
  it('accepts a cheque without amount and date (photographed first)', () => {
    expect(buildChequeCreate(form(), 100_000)).toEqual({ body: {} })
    expect(buildChequeCreate(form({ drawerName: 'سامي' }), 100_000)).toEqual({ body: { drawerName: 'سامي' } })
  })
  it('takes Arabic digits in the amount', () => {
    expect(buildChequeCreate(form({ amount: '٣٠٠' }), 100_000)).toEqual({ body: { amount: 30_000 } })
  })
  it('rejects a bad amount, an amount above what is left, and a bad date', () => {
    expect('error' in buildChequeCreate(form({ amount: 'abc' }), 100_000)).toBe(true)
    expect('error' in buildChequeCreate(form({ amount: '0' }), 100_000)).toBe(true)
    expect('error' in buildChequeCreate(form({ amount: '2000' }), 100_000)).toBe(true) // 2000 shekels > 1000 left
    expect('error' in buildChequeCreate(form({ dueDate: '1/12/2026' }), 100_000)).toBe(true)
  })
  it('a due date in the past is allowed (an old cheque)', () => {
    expect(buildChequeCreate(form({ amount: '10', dueDate: '2020-01-01' }), 100_000)).toEqual({ body: { amount: 1_000, dueDate: '2020-01-01' } })
  })
})

describe('buildChequeUpdate', () => {
  it('an empty text box clears that detail; amount and day are only sent when given', () => {
    expect(buildChequeUpdate(form({ amount: '50', bankName: '' }), Number.MAX_SAFE_INTEGER)).toEqual({
      body: { amount: 5_000, chequeNumber: '', bankName: '', accountNumber: '', drawerName: '', drawerPhone: '', notes: '' },
    })
  })
})

const row = (over: Partial<ChequeRow> = {}): ChequeRow => ({
  id: '1', direction: 'INCOMING', status: 'PENDING', amount: 12_345, dueDate: '2026-12-01', chequeNumber: '9', bankName: null, accountNumber: null, drawerName: null, drawerPhone: null, notes: null,
  hasImage: false, patientId: 'p', treatmentId: 't', paymentId: 'x', cashedAt: null, returnedAt: null, returnReason: null, createdAt: '2026-11-18T00:00:00Z', patient: null, treatment: null, incomplete: false, due: 'later', ...over,
})

describe('helpers', () => {
  it('the form is filled back from a cheque (agorot -> shekels)', () => {
    expect(formOfCheque(row())).toMatchObject({ amount: '123.45', dueDate: '2026-12-01', chequeNumber: '9', bankName: '' })
    expect(formOfCheque(row({ amount: null, dueDate: null }))).toMatchObject({ amount: '', dueDate: '' })
  })
  it('says what is missing on an incomplete cheque', () => {
    expect(missingOf({ amount: null, dueDate: null })).toBe('ينقصه: المبلغ وتاريخ الصرف')
    expect(missingOf({ amount: 5, dueDate: null })).toBe('ينقصه: تاريخ الصرف')
    expect(missingOf({ amount: 5, dueDate: '2026-01-01' })).toBe('')
  })
  it('filter tabs map to the API query', () => {
    expect(filterQuery('ALL')).toBe('')
    expect(filterQuery('PENDING')).toBe('status=PENDING')
    expect(filterQuery('INCOMPLETE')).toBe('incomplete=true')
  })
})
