// Form checks that turn what people typed into what the API wants (or an Arabic problem message).
import type { ClinicRow, CreateClinicInput } from './admin.ts'
import { daysLabel } from '../auth/paths.ts'
import { formatMoney, paidAtIso, parseShekels } from './format.ts'

const USERNAME = /^[a-z0-9_.-]{3,32}$/

/** Checks the create-clinic form and builds what the API wants. Returns an Arabic problem, or the request body. */
export function buildCreateInput(f: {
  name: string
  ownerName: string
  username: string
  phone: string
  specialty: string
  months: number
  price: string
}): { error: string } | { input: CreateClinicInput } {
  const name = f.name.trim()
  const ownerName = f.ownerName.trim()
  const username = f.username.trim().toLowerCase()
  const price = parseShekels(f.price)
  if (name.length < 2) return { error: 'اكتب اسم العيادة' }
  if (ownerName.length < 2) return { error: 'اكتب اسم المالك' }
  if (!USERNAME.test(username)) return { error: 'اسم المستخدم: من 3 إلى 32 خانة، أحرف إنجليزية صغيرة وأرقام و _ . - فقط' }
  if (f.phone.trim() && f.phone.trim().length < 5) return { error: 'رقم الجوال قصير' }
  if (f.specialty.trim() && f.specialty.trim().length < 2) return { error: 'التخصص قصير' }
  if (price === null) return { error: 'اكتب السعر كرقم، مثال: 3000' }
  return {
    input: {
      name,
      subscription: { months: f.months, price },
      owner: {
        fullName: ownerName,
        username,
        ...(f.phone.trim() ? { phone: f.phone.trim() } : {}),
        ...(f.specialty.trim() ? { specialty: f.specialty.trim() } : {}),
      },
    },
  }
}

/** Checks a payment form. Returns an Arabic problem, or the request body. */
export function buildPaymentInput(
  f: { amount: string; day: string; periodId: string; note: string },
  remaining: number,
): { error: string } | { input: { amount: number; periodId: string; paidAt?: string; note?: string } } {
  const amount = parseShekels(f.amount)
  if (amount === null || amount < 1) return { error: 'اكتب مبلغ الدفعة كرقم، مثال: 500' }
  if (amount > remaining) return { error: `المبلغ أكبر من المتبقي على هذه الفترة (${formatMoney(remaining)})` }
  return { input: { amount, periodId: f.periodId, ...(f.day ? { paidAt: paidAtIso(f.day) } : {}), ...(f.note.trim() ? { note: f.note.trim() } : {}) } }
}

/** "انتهى قبل يومين، باقي يوم للمهلة" */
export function endedNote(r: ClinicRow): { text: string; color: string } {
  const since = r.daysSinceEnd ?? 0
  const ago = since === 0 ? 'انتهى اليوم' : `انتهى قبل ${daysLabel(since)}`
  if (r.state === 'GRACE') return { text: `${ago}، باقي ${daysLabel(r.graceDaysLeft ?? 0)} للمهلة`, color: '#7a4a00' }
  return { text: `${ago}، الدخول مقفول`, color: '#9b1c1c' }
}
