import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from '../auth/AuthContext.tsx'
import { homePathFor } from '../auth/paths.ts'
import { checkNewPassword, MIN_PASSWORD } from '../auth/password.ts'
import { Alert, Button, TextField } from '../components/ui.tsx'
import { AuthShell } from '../components/AuthShell.tsx'
import { Icon } from '../components/icons.tsx'
import { ApiError, changePassword } from '../lib/api.ts'
import { ThemeScope } from '../theme/ThemeScope.tsx'

export default function ChangePasswordPage() {
  const { ready, session } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!ready) return <p className="p-8 text-muted">جاري التحميل...</p>
  if (!session) return <Navigate to="/login" replace />
  // Nothing to change (or just changed): go to the user's home.
  if (!session.mustChangePassword) return <Navigate to={homePathFor(session.user.role)} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = checkNewPassword(current, next, confirm)
    if (problem) return setError(problem)
    setError(null)
    setBusy(true)
    try {
      await changePassword(current, next)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'صار خطأ غير متوقع، جرب مرة ثانية')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ThemeScope platform>
      <AuthShell panelTitle="خطوة أخيرة لتأمين حسابك" panelText="كلمة المرور الحالية مؤقتة وعرفها غيرك. اختار كلمة جديدة بتعرفها إنت بس، وبعدها بتدخل على النظام.">
        <form onSubmit={submit} className="flex flex-col gap-7">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-bold">تغيير كلمة المرور</h1>
            <p className="text-base leading-7 text-muted">أهلاً {session.user.fullName}، لازم تغيّر كلمة المرور المؤقتة قبل ما تكمل.</p>
          </div>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="flex flex-col gap-4">
            <TextField label="كلمة المرور الحالية (المؤقتة)" icon={<Icon name="lock" />} type="password" dir="ltr" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            <TextField label="كلمة المرور الجديدة" hint={`${MIN_PASSWORD} خانات على الأقل`} icon={<Icon name="lock" />} type="password" dir="ltr" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
            <TextField label="تأكيد كلمة المرور الجديدة" icon={<Icon name="lock" />} type="password" dir="ltr" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <Button type="submit" busy={busy} className="h-14">
            حفظ ومتابعة
          </Button>
        </form>
      </AuthShell>
    </ThemeScope>
  )
}
