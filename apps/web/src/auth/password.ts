export const MIN_PASSWORD = 10

/** Returns an Arabic problem description, or null when the new password is acceptable. */
export function checkNewPassword(current: string, next: string, confirm: string): string | null {
  if (next.length < MIN_PASSWORD) return `يجب أن تتكون كلمة المرور الجديدة من ${MIN_PASSWORD} خانات على الأقل`
  if (next === current) return 'يجب أن تختلف كلمة المرور الجديدة عن الحالية'
  if (next !== confirm) return 'تأكيد كلمة المرور لا يطابق كلمة المرور الجديدة'
  return null
}
