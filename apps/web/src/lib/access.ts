import type { SessionUser } from './session.ts'

type Who = Pick<SessionUser, 'role' | 'canManagePayments'>

/** Owner, or any account the owner gave the payments key. Same rule as the API. */
export const canSeeMoney = (u: Who): boolean => u.role === 'OWNER' || u.canManagePayments === true

/** Creating, editing, cancelling treatments and finishing sessions: owner and doctors only. */
export const canEditTreatments = (u: Who): boolean => u.role === 'OWNER' || u.role === 'DOCTOR'

/** Who gets the treatments screens at all: a secretary only with the payments key. */
export const canSeeTreatments = (u: Who): boolean => canEditTreatments(u) || (u.role === 'SECRETARY' && canSeeMoney(u))
