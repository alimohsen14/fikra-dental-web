import { request } from './api.ts'

export interface BookingAppointment {
  id: string
  startsAt: string
  endsAt: string
  status: 'PENDING' | 'CONFIRMED'
  doctor: { id: string; fullName: string }
}

export interface BookingOverview {
  clinic: { name: string; themeColor: string | null; logoUrl: string | null }
  phoneEnding: string
  patients: { id: string; fullName: string; appointment: BookingAppointment | null }[]
  doctors: { id: string; fullName: string; specialty: string | null }[]
  horizonDays: number
}

export interface BookedResult {
  id: string
  startsAt: string
  endsAt: string
  status: string
}

// The page has no login: the token in the address is the key.
const at = (token: string, path = '') => `/public/book/${encodeURIComponent(token)}${path}`
const open = { auth: false } as const

export const getOverview = (token: string) => request<BookingOverview>(at(token), open)
export const registerSelf = (token: string, body: Record<string, string>) => request<{ id: string; fullName: string }>(at(token, '/register'), { ...open, method: 'POST', body })
export const getBookingDays = (token: string, doctorId: string, appointmentId?: string) => {
  const qs = new URLSearchParams({ doctorId, ...(appointmentId ? { appointmentId } : {}) })
  return request<{ days: { date: string; count: number }[] }>(at(token, `/days?${qs}`), open)
}
export const getBookingSlots = (token: string, doctorId: string, date: string, appointmentId?: string) => {
  const qs = new URLSearchParams({ doctorId, date, ...(appointmentId ? { appointmentId } : {}) })
  return request<{ slots: string[] }>(at(token, `/slots?${qs}`), open)
}
export const bookSelf = (token: string, body: { patientId: string; doctorId: string; startsAt: string }) => request<BookedResult>(at(token, '/appointments'), { ...open, method: 'POST', body })
export const moveSelf = (token: string, id: string, body: { doctorId?: string; startsAt: string }) => request<BookedResult>(at(token, `/appointments/${id}`), { ...open, method: 'PATCH', body })
export const cancelSelf = (token: string, id: string) => request<{ ok: true }>(at(token, `/appointments/${id}/cancel`), { ...open, method: 'POST' })

/** Test mode (clinic staff, logged in): pretend a patient wrote to the clinic's WhatsApp number. */
export const simulateIncoming = (phone: string) => request<{ url: string }>('/whatsapp/simulate-incoming', { method: 'POST', body: { phone } })

/** The token is the last part of the page address, whatever the host. */
export const tokenFromLink = (link: string): string => link.split('/book/')[1] ?? ''

/** What the patient is told after booking, depending on whether it still waits for his answer to the reminder. */
export function bookedNote(status: string): string {
  return status === 'CONFIRMED' ? 'موعدك مؤكد، بانتظارك.' : 'سيصلك تذكير عبر واتساب قبل الموعد بيومين، ردّ عليه بكلمة «نعم» لتأكيد موعدك.'
}

/** Groups the days that have free time by month so a long list stays readable. */
export function groupByMonth(days: { date: string; count: number }[]): { month: string; days: { date: string; count: number }[] }[] {
  const out: { month: string; days: { date: string; count: number }[] }[] = []
  for (const d of days) {
    const month = d.date.slice(0, 7)
    const last = out[out.length - 1]
    if (last && last.month === month) last.days.push(d)
    else out.push({ month, days: [d] })
  }
  return out
}

/** "تشرين الثاني 2026" with Western digits. */
export const monthTitle = (month: string): string => new Intl.DateTimeFormat('ar-u-nu-latn', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`))
