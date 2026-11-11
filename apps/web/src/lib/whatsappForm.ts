export interface WhatsappForm {
  phoneNumberId: string
  businessAccountId: string
  accessToken: string
}

export type WhatsappInput = { phoneNumberId: string; businessAccountId: string | null; accessToken?: string }

const DIGITS = /^\d{5,30}$/

/** Checks what the platform admin typed. The token is required the first time and optional after (empty = keep the saved one). */
export function buildWhatsappInput(f: WhatsappForm, alreadySaved: boolean): { input: WhatsappInput } | { error: string } {
  const phoneNumberId = f.phoneNumberId.trim()
  const businessAccountId = f.businessAccountId.trim()
  const accessToken = f.accessToken.trim()
  if (!DIGITS.test(phoneNumberId)) return { error: 'معرّف رقم الهاتف أرقام فقط (من لوحة ميتا)' }
  if (businessAccountId && !DIGITS.test(businessAccountId)) return { error: 'معرّف حساب واتساب أرقام فقط' }
  if (!alreadySaved && !accessToken) return { error: 'يجب إدخال الرمز (التوكن) في المرة الأولى' }
  if (accessToken && accessToken.length < 20) return { error: 'الرمز (التوكن) قصير، تأكد من نسخه كاملاً' }
  return { input: { phoneNumberId, businessAccountId: businessAccountId || null, ...(accessToken ? { accessToken } : {}) } }
}
