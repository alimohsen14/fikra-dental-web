import { describe, expect, it } from 'vitest'
import { buildSubCheque, emptySubChequeForm } from './sub-cheque-ui.tsx'

describe('buildSubCheque', () => {
  it('needs only the due date; empty boxes are not sent', () => {
    expect(buildSubCheque(emptySubChequeForm())).toEqual({ error: 'اكتب تاريخ صرف الشك' })
    expect(buildSubCheque({ ...emptySubChequeForm(), dueDate: '2026-12-01' })).toEqual({ cheque: { dueDate: '2026-12-01' } })
    expect(buildSubCheque({ ...emptySubChequeForm(), dueDate: '2026-12-01', chequeNumber: ' 55 ', bankName: 'بنك' })).toEqual({ cheque: { dueDate: '2026-12-01', chequeNumber: '55', bankName: 'بنك' } })
  })
})
