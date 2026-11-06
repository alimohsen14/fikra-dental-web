import { useState } from 'react'
import type { FormEvent } from 'react'
import { Badge, Card, DateText, Loading } from '../../components/admin-ui.tsx'
import { Alert, Button, TextField } from '../../components/ui.tsx'
import { getWhatsapp, removeWhatsapp, saveWhatsapp } from '../../lib/admin.ts'
import type { WhatsappSettings } from '../../lib/admin.ts'
import { ApiError } from '../../lib/api.ts'
import { useLoad } from '../../lib/useLoad.ts'
import { buildWhatsappInput } from '../../lib/whatsappForm.ts'

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'صار خطأ غير متوقع، جرب مرة ثانية')

function Form({ clinicId, saved, onSaved }: { clinicId: string; saved: WhatsappSettings; onSaved: (s: WhatsappSettings) => void }) {
  const [phoneNumberId, setPhoneNumberId] = useState(saved.phoneNumberId ?? '')
  const [businessAccountId, setBusinessAccountId] = useState(saved.businessAccountId ?? '')
  const [accessToken, setAccessToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const r = buildWhatsappInput({ phoneNumberId, businessAccountId, accessToken }, saved.configured)
    if ('error' in r) return setError(r.error)
    setError(null)
    setDone(false)
    setBusy(true)
    try {
      onSaved(await saveWhatsapp(clinicId, r.input))
      setAccessToken('') // never keep the token on screen
      setDone(true)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      onSaved(await removeWhatsapp(clinicId))
      setPhoneNumberId('')
      setBusinessAccountId('')
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <TextField label="معرّف رقم الهاتف (Phone number ID)" dir="ltr" className="text-right" inputMode="numeric" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} />
      <TextField label="معرّف حساب واتساب (اختياري)" dir="ltr" className="text-right" inputMode="numeric" value={businessAccountId} onChange={(e) => setBusinessAccountId(e.target.value)} />
      <TextField
        label="التوكن (Access token)"
        type="password"
        autoComplete="off"
        dir="ltr"
        className="text-right"
        hint={saved.configured ? 'التوكن محفوظ ومشفّر. اتركه فاضي إذا ما بدك تغيّره.' : 'بيتخزّن مشفّر وما بيظهر مرة ثانية.'}
        value={accessToken}
        onChange={(e) => setAccessToken(e.target.value)}
      />
      {error && <Alert tone="error">{error}</Alert>}
      {done && <Alert tone="success">تم الحفظ.</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" busy={busy}>
          حفظ
        </Button>
        {saved.configured && (
          <Button type="button" size="sm" variant="danger" disabled={busy} onClick={remove}>
            حذف الربط
          </Button>
        )}
      </div>
    </form>
  )
}

/** The clinic's WhatsApp number. Only the platform admin can see or change it; the token is never shown. */
export function WhatsappCard({ clinicId }: { clinicId: string }) {
  const q = useLoad(() => getWhatsapp(clinicId), [clinicId])
  const [override, setOverride] = useState<WhatsappSettings | null>(null)
  const saved = override ?? q.data
  return (
    <Card title="رقم واتساب العيادة" hint="الرسائل بتنرسل من هذا الرقم. بس إنت بتعدّله.">
      {!saved ? (
        q.error ? <Alert tone="error">{q.error}</Alert> : <Loading />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            {saved.configured ? <Badge label="مربوط" bg="#e3f5ea" fg="#0b6b3a" /> : <Badge label="غير مربوط" bg="#e8ecf1" fg="#3d4b60" />}
            {saved.updatedAt && (
              <span className="text-muted">
                آخر تعديل: <DateText value={saved.updatedAt} />
              </span>
            )}
          </p>
          <Form clinicId={clinicId} saved={saved} onSaved={setOverride} />
        </div>
      )}
    </Card>
  )
}
