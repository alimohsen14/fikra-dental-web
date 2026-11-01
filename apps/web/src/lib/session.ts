// The logged-in session lives ONLY in memory (never localStorage): a script injected into the page
// cannot steal it. After a page reload we get a new one from the httpOnly refresh cookie.

export type Role = 'PLATFORM_ADMIN' | 'OWNER' | 'DOCTOR' | 'SECRETARY'

export interface SessionUser {
  id: string
  fullName: string
  role: Role
  clinicId: string | null
  canManagePayments?: boolean // the owner's "payments key" (the owner always has it)
}

// What the app needs to look like the clinic: name, accent color and logo.
export interface ClinicBrand {
  id: string
  name: string
  themeColor: string | null
  logoUrl: string | null
}

export interface SubscriptionWarning {
  endsAt: string
  graceDaysLeft: number
}

export interface Session {
  accessToken: string
  mustChangePassword: boolean
  subscriptionWarning: SubscriptionWarning | null // owner only
  user: SessionUser
  clinic: ClinicBrand | null // null for the platform admin
}

let current: Session | null = null
const listeners = new Set<() => void>()

export const getSession = (): Session | null => current

export function setSession(next: Session | null): void {
  current = next
  listeners.forEach((l) => l())
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** After the owner edits the clinic identity: the app re-colors itself without a new login. */
export function updateClinicBrand(clinic: ClinicBrand): void {
  if (current) setSession({ ...current, clinic })
}
