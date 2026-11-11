import { request } from './api.ts'

export interface Xray {
  id: string
  createdAt: string
  note: string | null
  size: number
  treatmentId: string
  patientId: string
  uploadedByUserId: string
  uploadedBy: { fullName: string }
  treatment: { description: string | null }
}

export const listTreatmentXrays = (treatmentId: string) => request<Xray[]>(`/treatments/${treatmentId}/xrays`)
export const listPatientXrays = (patientId: string) => request<Xray[]>(`/patients/${patientId}/xrays`)
export const deleteXray = (id: string) => request<{ ok: true }>(`/xrays/${id}`, { method: 'DELETE' })
/** The image itself needs the login, so it is fetched with the token and shown from memory (an <img src> could not send it). */
export const fetchXrayImage = (id: string) => request<Blob>(`/xrays/${id}/file`, { blob: true })
export const uploadXray = (treatmentId: string, image: Blob, note: string) =>
  request<Xray>(`/treatments/${treatmentId}/xrays${note.trim() ? `?note=${encodeURIComponent(note.trim())}` : ''}`, { method: 'POST', file: image })

export const XRAY_MAX_BYTES = 10 * 1024 * 1024
/** Bigger than this and the picture is shrunk before it goes up (an X-ray stays perfectly readable at 2400 px). */
export const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024
export const MAX_SIDE = 2400
const TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** null when the file is fine to send, otherwise the reason (Arabic) it is not. */
export function xrayFileError(f: { type: string; size: number }): string | null {
  if (!TYPES.includes(f.type)) return 'الملف لازم يكون صورة (JPG أو PNG أو WEBP)'
  return null
}

/** New size so that the longest side is at most `max`, never enlarging. */
export function fitWithin(width: number, height: number, max: number = MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= max) return { width, height }
  const k = max / longest
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) }
}

/** Large pictures are shrunk to a JPEG in the browser; small ones go up untouched. Falls back to the original if the browser cannot decode it. */
export async function prepareXray(file: File): Promise<Blob> {
  if (file.size <= SHRINK_ABOVE_BYTES) return file
  try {
    const bitmap = await createImageBitmap(file)
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88))
    return out && out.size < file.size ? out : file
  } catch {
    return file
  }
}

export const sizeLabel = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)
