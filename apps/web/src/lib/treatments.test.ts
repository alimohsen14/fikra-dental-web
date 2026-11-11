import { describe, expect, it } from 'vitest'
import { EMPTY_TREATMENT, buildCreateTreatment, buildEditTreatment, buildTreatmentPayment, copyTypeToAll, entriesOf, resolveTypeId, setEntrySub, setEntryType, toggleEntry, typeIdsOf } from './treatmentForm.ts'
import type { ToothEntry } from './treatmentForm.ts'
import { buildNewType, canBookSession, canClose, nextBookable, pickableTypes, sessionCaption, sessionsDone, toothMarks, typeLabel, typeLabels, typeTree } from './treatments.ts'
import type { SessionRow, TreatmentType } from './treatments.ts'

const T = (id: string, name: string, parentId: string | null = null, isActive = true): TreatmentType => ({ id, name, parentId, isActive })
const types = [T('crown', 'تلبيسة'), T('zir', 'زركون', 'crown'), T('por', 'بورسلان', 'crown', false), T('clean', 'تنظيف'), T('old', 'قديم', null, false)]

describe('type tree', () => {
  it('groups sub-types under their type', () => {
    const tree = typeTree(types)
    expect(tree.map((n) => [n.type.id, n.children.map((c) => c.id)])).toEqual([['crown', ['zir', 'por']], ['clean', []], ['old', []]])
  })
  it('offers only active ones, plus the ones an old treatment already uses', () => {
    expect(pickableTypes(types).map((n) => [n.type.id, n.children.map((c) => c.id)])).toEqual([['crown', ['zir']], ['clean', []]])
    expect(pickableTypes(types, ['old', 'por']).map((n) => [n.type.id, n.children.map((c) => c.id)])).toEqual([['crown', ['zir', 'por']], ['clean', []], ['old', []]])
  })
  it('labels a sub-type with its parent', () => {
    expect(typeLabel({ id: 'z', name: 'زركون', parent: { id: 'c', name: 'تلبيسة' } })).toBe('تلبيسة › زركون')
    expect(typeLabel({ id: 'c', name: 'تنظيف', parent: null })).toBe('تنظيف')
  })
  it('a type with active sub-types needs one; one without uses itself', () => {
    expect(resolveTypeId(types, '', '')).toEqual({ error: 'اختر نوع العلاج' })
    expect(resolveTypeId(types, 'crown', '')).toEqual({ error: 'اختر النوع الفرعي' })
    expect(resolveTypeId(types, 'crown', 'por')).toEqual({ error: 'هذا النوع الفرعي موقوف، اختر غيره' })
    expect(resolveTypeId(types, 'crown', 'clean')).toEqual({ error: 'النوع الفرعي لا يتبع هذا النوع' })
    expect(resolveTypeId(types, 'crown', 'zir')).toEqual({ id: 'zir' })
    expect(resolveTypeId(types, 'clean', '')).toEqual({ id: 'clean' })
  })
})

const E = (code: number, typeId = 'clean', subTypeId = ''): ToothEntry => ({ code, typeId, subTypeId })
const ok = { ...EMPTY_TREATMENT, patientId: 'p1', doctorId: 'd1', teeth: [E(26), E(16)], cost: '800', sessions: '2' } // FDI 26 and 16

describe('create form', () => {
  it('builds the API body with sorted teeth and agorot', () => {
    const r = buildCreateTreatment({ ...ok, description: '  حشوة عميقة ' }, types)
    expect(r).toEqual({ body: { patientId: 'p1', doctorId: 'd1', teeth: [{ toothCode: 16, treatmentTypeId: 'clean' }, { toothCode: 26, treatmentTypeId: 'clean' }], totalCost: 80000, plannedSessions: 2, description: 'حشوة عميقة' } })
  })
  it('a linked appointment is sent, a plain day becomes the start time', () => {
    expect(buildCreateTreatment({ ...ok, appointmentId: 'a1' }, types)).toMatchObject({ body: { appointmentId: 'a1' } })
    const r = buildCreateTreatment({ ...ok, day: '2020-01-05' }, types)
    expect('body' in r && typeof r.body.startedAt).toBe('string')
    expect('body' in r && 'appointmentId' in r.body).toBe(false)
  })
  it('a free treatment (0) is fine', () => {
    expect(buildCreateTreatment({ ...ok, cost: '0' }, types)).toMatchObject({ body: { totalCost: 0 } })
  })
  it('says what is missing, in Arabic, one thing at a time', () => {
    const err = (v: Partial<typeof ok>) => {
      const r = buildCreateTreatment({ ...ok, ...v }, types)
      return 'error' in r ? r.error : 'OK'
    }
    expect(err({ patientId: '' })).toBe('اختر المريض')
    expect(err({ doctorId: '' })).toBe('اختر الدكتور')
    expect(err({ teeth: [E(16, '')] })).toBe('السن 3: اختر نوع العلاج')
    expect(err({ teeth: [E(16), E(11, 'crown')] })).toBe('السن 8: اختر النوع الفرعي') // each tooth is checked, and named the way the clinic reads it
    expect(err({ teeth: [E(55, 'crown', 'por')] })).toBe('السن A: هذا النوع الفرعي موقوف، اختر غيره')
    expect(err({ teeth: [] })).toMatch(/سن/)
    expect(err({ cost: '' })).toMatch(/التكلفة/)
    expect(err({ cost: 'abc' })).toMatch(/التكلفة/)
    expect(err({ sessions: '0' })).toMatch(/الجلسات/)
    expect(err({ sessions: '51' })).toMatch(/الجلسات/)
    expect(err({ sessions: '1.5' })).toMatch(/الجلسات/)
  })
})

describe('edit form', () => {
  it('sends an empty description as empty so the API clears it', () => {
    expect(buildEditTreatment({ ...ok, description: ' ' }, types)).toEqual({ body: { teeth: [{ toothCode: 16, treatmentTypeId: 'clean' }, { toothCode: 26, treatmentTypeId: 'clean' }], totalCost: 80000, plannedSessions: 2, description: '' } })
  })
  it('does not need a patient or doctor', () => {
    expect('body' in buildEditTreatment({ ...ok, patientId: '', doctorId: '' }, types)).toBe(true)
  })
})

describe('a different type for each tooth', () => {
  it('sends every tooth with its own type (a sub-type when it has one), in chart order', () => {
    const r = buildCreateTreatment({ ...ok, teeth: [E(36, 'clean'), E(16, 'crown', 'zir'), E(48, 'clean')] }, types)
    expect(r).toMatchObject({ body: { teeth: [{ toothCode: 16, treatmentTypeId: 'zir' }, { toothCode: 36, treatmentTypeId: 'clean' }, { toothCode: 48, treatmentTypeId: 'clean' }], totalCost: 80000, plannedSessions: 2 } })
  })
  it('a new tooth starts with the last tooth type; removing one keeps the others', () => {
    let teeth: ToothEntry[] = []
    teeth = toggleEntry(teeth, 16)
    expect(teeth).toEqual([E(16, '')])
    teeth = setEntryType(teeth, 16, 'crown')
    teeth = setEntrySub(teeth, 16, 'zir')
    teeth = toggleEntry(teeth, 26)
    expect(teeth).toEqual([E(16, 'crown', 'zir'), E(26, 'crown', 'zir')])
    teeth = setEntryType(teeth, 26, 'clean')
    expect(teeth[1]).toEqual(E(26, 'clean', '')) // changing the type clears the sub-type
    expect(toggleEntry(teeth, 16)).toEqual([E(26, 'clean')])
  })
  it('keeps the chart order (universal 1-32, then baby letters)', () => {
    let teeth: ToothEntry[] = []
    for (const c of [48, 55, 16, 21]) teeth = toggleEntry(teeth, c)
    expect(teeth.map((t) => t.code)).toEqual([16, 21, 48, 55])
  })
  it('copies one tooth type to all', () => {
    expect(copyTypeToAll([E(16, 'crown', 'zir'), E(26, 'clean')], 16)).toEqual([E(16, 'crown', 'zir'), E(26, 'crown', 'zir')])
  })
  const treatment = {
    teeth: [
      { toothCode: 26, treatmentTypeId: 'clean', treatmentType: { id: 'clean', name: 'تنظيف', parent: null } },
      { toothCode: 16, treatmentTypeId: 'zir', treatmentType: { id: 'zir', name: 'زركون', parent: { id: 'crown', name: 'تلبيسة' } } },
      { toothCode: 17, treatmentTypeId: 'clean', treatmentType: { id: 'clean', name: 'تنظيف', parent: null } },
    ],
  }
  it('opens an old treatment with each tooth type, and lists the different types once', () => {
    expect(entriesOf(treatment)).toEqual([E(17, 'clean'), E(16, 'crown', 'zir'), E(26, 'clean')]) // 17 is tooth 2, 16 is tooth 3
    expect(typeLabels(treatment)).toEqual(['تنظيف', 'تلبيسة › زركون'])
    expect(typeIdsOf(treatment).sort()).toEqual(['clean', 'clean', 'crown', 'zir'])
  })
})

describe('payment form', () => {
  const f = { amount: '300', method: 'CASH' as const, day: '2020-02-01', note: ' دفعة أولى ' }
  it('builds the body', () => {
    const r = buildTreatmentPayment(f, 80000)
    expect(r).toMatchObject({ body: { amount: 30000, method: 'CASH', note: 'دفعة أولى' } })
  })
  it('refuses nothing, zero, too much, and no date', () => {
    const err = (x: Partial<typeof f>, rem = 80000) => {
      const r = buildTreatmentPayment({ ...f, ...x }, rem)
      return 'error' in r ? r.error : 'OK'
    }
    expect(err({ amount: '' })).toMatch(/مبلغ/)
    expect(err({ amount: '0' })).toMatch(/مبلغ/)
    expect(err({ amount: '900' })).toMatch(/أكبر من المتبقي/)
    expect(err({ amount: '800.01' })).toMatch(/أكبر من المتبقي/) // one agora too much
    expect(err({ amount: '800' })).toBe('OK') // exactly what is left
    expect(err({ day: '' })).toMatch(/تاريخ/)
  })
})

describe('sessions', () => {
  const S = (number: number, status: SessionRow['status'], apt?: 'PENDING' | 'CANCELLED'): SessionRow => ({
    id: `s${number}`,
    number,
    status,
    completedAt: null,
    notes: null,
    appointmentId: apt ? `a${number}` : null,
    appointment: apt ? { id: `a${number}`, startsAt: '2026-11-02T07:00:00Z', endsAt: '2026-11-02T07:30:00Z', status: apt } : null,
  })
  it('counts finished ones', () => {
    expect(sessionsDone({ sessions: [S(1, 'COMPLETED'), S(2, 'PLANNED')] })).toBe(1)
  })
  it('the next bookable session skips finished and already booked ones, but not cancelled bookings', () => {
    expect(nextBookable({ status: 'OPEN', sessions: [S(1, 'COMPLETED'), S(2, 'PLANNED', 'PENDING'), S(3, 'PLANNED')] })?.number).toBe(3)
    expect(nextBookable({ status: 'OPEN', sessions: [S(1, 'PLANNED', 'CANCELLED'), S(2, 'PLANNED')] })?.number).toBe(1)
    expect(nextBookable({ status: 'OPEN', sessions: [S(1, 'COMPLETED')] })).toBeNull()
    expect(nextBookable({ status: 'CLOSED', sessions: [S(1, 'PLANNED')] })).toBeNull()
  })
})

describe('what a user may do on a treatment', () => {
  it('booking: whoever edits it, or a secretary with the payments key; not a doctor on a colleague treatment', () => {
    expect(canBookSession({ access: { edit: true, pay: true } })).toBe(true) // owner, or the treating doctor
    expect(canBookSession({ access: { edit: false, pay: true } })).toBe(true) // secretary with the key
    expect(canBookSession({ access: { edit: false, pay: false } })).toBe(false) // another doctor
  })
})

describe('the close button', () => {
  const S2 = (n: number, done: boolean): SessionRow => ({ id: `s${n}`, number: n, status: done ? 'COMPLETED' : 'PLANNED', completedAt: null, notes: null, appointmentId: null, appointment: null })
  const open = (sessions: SessionRow[], remaining?: number) => ({ status: 'OPEN' as const, sessions, remaining })
  it('needs at least one session done AND nothing left to pay (early finish is allowed)', () => {
    expect(canClose(open([S2(1, true), S2(2, true)], 0))).toBe(true)
    expect(canClose(open([S2(1, true), S2(2, false)], 0))).toBe(true) // finished early: the rest is dropped
    expect(canClose(open([S2(1, true), S2(2, true)], 1))).toBe(false) // one agora owed
    expect(canClose(open([S2(1, false), S2(2, false)], 0))).toBe(false) // nothing done yet
    expect(canClose(open([S2(1, false)], 500))).toBe(false) // neither
  })
  it('a doctor without the payments key sees no money: the button waits only for a done session', () => {
    expect(canClose(open([S2(1, true)]))).toBe(true)
    expect(canClose(open([S2(1, false)]))).toBe(false)
  })
  it('never for a closed or cancelled treatment, or one without done sessions', () => {
    expect(canClose({ status: 'CLOSED', sessions: [S2(1, true)], remaining: 0 })).toBe(false)
    expect(canClose({ status: 'CANCELLED', sessions: [S2(1, true)], remaining: 0 })).toBe(false)
    expect(canClose(open([], 0))).toBe(false)
  })
})

describe('tooth colors', () => {
  it('open wins over closed, cancelled is ignored', () => {
    expect(
      toothMarks([
        { status: 'CLOSED', toothCodes: [16, 26] },
        { status: 'OPEN', toothCodes: [16] },
        { status: 'CANCELLED', toothCodes: [36] },
      ]),
    ).toEqual({ 16: 'OPEN', 26: 'CLOSED' })
    expect(toothMarks([{ status: 'OPEN', toothCodes: [16] }, { status: 'CLOSED', toothCodes: [16] }])).toEqual({ 16: 'OPEN' })
  })
})

describe('sessionCaption', () => {
  const apt = { startsAt: '2026-11-20T10:00:00.000Z', status: 'CONFIRMED' }
  it('a finished session shows the day it was closed, even before its appointment', () => {
    expect(sessionCaption({ status: 'COMPLETED', completedAt: '2026-11-10T08:00:00.000Z', appointment: apt } as never)).toEqual({ kind: 'closed', at: '2026-11-10T08:00:00.000Z' })
  })
  it('an open session shows its live appointment, never a cancelled one', () => {
    expect(sessionCaption({ status: 'PLANNED', completedAt: null, appointment: apt } as never)).toEqual({ kind: 'appointment', at: apt.startsAt })
    expect(sessionCaption({ status: 'PLANNED', completedAt: null, appointment: { ...apt, status: 'CANCELLED' } } as never)).toBeNull()
    expect(sessionCaption({ status: 'PLANNED', completedAt: null, appointment: null } as never)).toBeNull()
  })
})

describe('buildNewType', () => {
  it('a main type with its sub-types: trimmed, empty rows dropped, duplicates once', () => {
    expect(buildNewType({ parentId: '', name: '  تلبيسة ', subs: [' زركون ', '', 'بورسلان', 'زركون'] })).toEqual({ parentId: null, name: 'تلبيسة', subs: ['زركون', 'بورسلان'] })
    expect(buildNewType({ parentId: '', name: 'حشوة', subs: [] })).toEqual({ parentId: null, name: 'حشوة', subs: [] })
  })
  it('under an existing type it adds just one sub-type', () => {
    expect(buildNewType({ parentId: 'p1', name: 'زركون', subs: ['x'] })).toEqual({ parentId: 'p1', name: 'زركون', subs: [] })
  })
  it('refuses short or missing names', () => {
    expect(buildNewType({ parentId: '', name: 'ح', subs: [] })).toHaveProperty('error')
    expect(buildNewType({ parentId: '', name: 'حشوة', subs: ['ز'] })).toHaveProperty('error')
    expect(buildNewType({ parentId: 'p1', name: '', subs: [] })).toHaveProperty('error')
  })
})
