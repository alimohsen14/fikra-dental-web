import type { ClinicState } from '../lib/admin.ts'

export const STATE_STYLE: Record<ClinicState, { label: string; bg: string; fg: string }> = {
  ACTIVE: { label: 'فعّالة', bg: '#e3f5ea', fg: '#0b6b3a' },
  GRACE: { label: 'ضمن المهلة', bg: '#fff1d6', fg: '#7a4a00' },
  EXPIRED: { label: 'منتهية', bg: '#fde8e8', fg: '#9b1c1c' },
  SUSPENDED: { label: 'موقوفة', bg: '#e8ecf1', fg: '#3d4b60' },
}

export const COLOR_PRESETS: { value: string; name: string }[] = [
  { value: '#0b5d57', name: 'أخضر مزرق' },
  { value: '#1d4ed8', name: 'أزرق' },
  { value: '#6d3fc0', name: 'بنفسجي' },
  { value: '#a32a3b', name: 'أحمر داكن' },
  { value: '#b45309', name: 'برتقالي داكن' },
  { value: '#3d4b60', name: 'رمادي أزرق' },
]
