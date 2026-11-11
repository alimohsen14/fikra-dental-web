import { request } from './api.ts'
import { updateClinicBrand } from './session.ts'
import type { ClinicBrand } from './session.ts'

export const LOGO_MAX_BYTES = 512 * 1024
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/** Checks a picked logo file before uploading. Returns an Arabic problem, or null when it is fine. (The server checks again.) */
export function checkLogoFile(f: { type: string; size: number }): string | null {
  if (!LOGO_TYPES.includes(f.type)) return 'يجب أن تكون الصورة بصيغة PNG أو JPG أو WebP'
  if (f.size > LOGO_MAX_BYTES) return 'الصورة كبيرة، الحد الأقصى 512 كيلوبايت'
  if (f.size === 0) return 'الملف فارغ'
  return null
}

async function apply(call: Promise<ClinicBrand>): Promise<ClinicBrand> {
  const brand = await call
  updateClinicBrand(brand)
  return brand
}

export const saveClinicSettings = (body: { name?: string; themeColor?: string | null }) =>
  apply(request<ClinicBrand>('/clinic/settings', { method: 'PATCH', body }))
export const uploadClinicLogo = (file: File) => apply(request<ClinicBrand>('/clinic/logo', { method: 'PUT', file }))
export const removeClinicLogo = () => apply(request<ClinicBrand>('/clinic/logo', { method: 'DELETE' }))
