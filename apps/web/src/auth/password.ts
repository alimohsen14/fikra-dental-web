export const MIN_PASSWORD = 10

/** Returns an Arabic problem description, or null when the new password is acceptable. */
export function checkNewPassword(current: string, next: string, confirm: string): string | null {
  if (next.length < MIN_PASSWORD) return `كلمة المرور الجديدة لازم تكون ${MIN_PASSWORD} خانات على الأقل`
  if (next === current) return 'كلمة المرور الجديدة لازم تختلف عن الحالية'
  if (next !== confirm) return 'تأكيد كلمة المرور ما بطابق'
  return null
}
