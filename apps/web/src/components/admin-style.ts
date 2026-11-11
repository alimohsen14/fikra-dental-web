import type { ClinicState } from '../lib/admin.ts'

export const STATE_STYLE: Record<ClinicState, { label: string; bg: string; fg: string }> = {
  ACTIVE: { label: 'فعّالة', bg: '#e3f5ea', fg: '#0b6b3a' },
  GRACE: { label: 'ضمن المهلة', bg: '#fff1d6', fg: '#7a4a00' },
  EXPIRED: { label: 'منتهية', bg: '#fde8e8', fg: '#9b1c1c' },
  SUSPENDED: { label: 'موقوفة', bg: '#e8ecf1', fg: '#3d4b60' },
}

/** Hand-picked colors that look good with the rest of the app (white or dark text is chosen automatically for each). */
export const COLOR_PRESETS: { value: string; name: string }[] = [
  { value: '#0b5d57', name: 'تركوازي' },
  { value: '#0f7b6c', name: 'زمردي' },
  { value: '#2457c5', name: 'أزرق ملكي' },
  { value: '#0b7fa8', name: 'سماوي' },
  { value: '#1e3a5f', name: 'كحلي' },
  { value: '#6a42c2', name: 'بنفسجي' },
  { value: '#9b2c46', name: 'عنابي' },
  { value: '#c0456b', name: 'وردي' },
  { value: '#b4540a', name: 'برتقالي محروق' },
  { value: '#3b4a5e', name: 'رمادي فحمي' },
]
