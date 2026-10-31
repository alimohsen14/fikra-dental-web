import type { Role } from '../lib/session.ts'

/** Where each kind of user lands after login. */
export const homePathFor = (role: Role): string => (role === 'PLATFORM_ADMIN' ? '/admin' : '/patients')

export const ROLE_LABELS: Record<Role, string> = {
  PLATFORM_ADMIN: 'مدير المنصة',
  OWNER: 'مالك',
  DOCTOR: 'دكتور',
  SECRETARY: 'سكرتارية',
}

/** "يوم واحد" / "يومان" / "3 أيام" */
export function daysLabel(n: number): string {
  if (n === 1) return 'يوم واحد'
  if (n === 2) return 'يومان'
  return `${n} أيام`
}
