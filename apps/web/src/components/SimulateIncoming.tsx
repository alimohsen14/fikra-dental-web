import { useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from '../lib/api.ts'
import { simulateIncoming } from '../lib/booking.ts'
import { useTestMode } from '../lib/useTestMode.ts'
import { Alert, Button, TextField } from './ui.tsx'

/** Test mode only: pretends a patient wrote to the clinic's WhatsApp number and shows the link he would receive. */
export function SimulateIncoming() {
  const testMode = useTestMode()
  const [phone, setPhone] = useState('')
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!testMode) return null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setLink(null)
    try {
      setLink((await simulateIncoming(phone)).url)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'صار خطأ غير متوقع، جرب مرة ثانية')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} aria-label="تجربة حجز المريض" className="flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-line bg-white p-4">
      <span className="w-full text-sm font-semibold">وضع التجربة: مريض بعث رسالة لرقم واتساب العيادة</span>
      <div className="w-64">
        <TextField label="رقم المريض" dir="ltr" inputMode="tel" className="text-right" placeholder="0599123456" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <Button type="submit" size="sm" busy={busy}>
        إرسال الرسالة
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
      {link && (
        <p className="w-full text-sm leading-7">
          بعتنا له الرابط:{' '}
          <a href={link} target="_blank" rel="noreferrer" className="break-all underline" dir="ltr">
            {link}
          </a>
        </p>
      )}
    </form>
  )
}
