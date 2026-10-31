import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from '../auth/AuthContext.tsx'
import { Alert, Button, TextField } from '../components/ui.tsx'
import { AuthShell } from '../components/AuthShell.tsx'
import { Icon } from '../components/icons.tsx'
import { ApiError, login, verifyTwoFactor } from '../lib/api.ts'
import { ThemeScope } from '../theme/ThemeScope.tsx'

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'صار خطأ غير متوقع، جرب مرة ثانية')

export default function LoginPage() {
  const { ready, session } = useAuth()
  const [challenge, setChallenge] = useState<string | null>(null) // set after the password step (platform admin)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (ready && session) return <Navigate to="/" replace />

  async function submitPassword(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result = await login(username, password)
      if (result.kind === 'challenge') {
        setChallenge(result.challengeToken)
        setPassword('')
      }
      // kind === 'session': the session is saved and this page redirects by itself
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault()
    if (!challenge) return
    setError(null)
    setBusy(true)
    try {
      await verifyTwoFactor(challenge, code)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  function backToPassword() {
    setChallenge(null)
    setCode('')
    setUseRecovery(false)
    setError(null)
  }

  return (
    <ThemeScope platform>
      {challenge === null ? (
        <AuthShell
          panelTitle="نظام متكامل لإدارة عيادة الأسنان"
          panelText="ملفات المرضى، المواعيد، العلاجات والدفعات، كلها بمكان واحد، وبهوية عيادتك."
          features={['مواعيد مرتبة وتأكيد عبر واتساب', 'خطط علاج وجلسات ودفعات واضحة لكل مريض', 'بيانات كل عيادة معزولة ومحمية']}
        >
          <form onSubmit={submitPassword} className="flex flex-col gap-7">
            <div className="flex flex-col gap-2">
              <h1 className="text-3xl font-bold">أهلاً بعودتك</h1>
              <p className="text-base leading-7 text-muted">سجّل الدخول بحسابك للوصول إلى نظام العيادة.</p>
            </div>
            {error && <Alert tone="error">{error}</Alert>}
            <div className="flex flex-col gap-4">
              <TextField
                label="اسم المستخدم"
                icon={<Icon name="user" />}
                dir="ltr"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="text-right"
              />
              <TextField
                label="كلمة المرور"
                icon={<Icon name="lock" />}
                type="password"
                dir="ltr"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" busy={busy} className="h-14">
              دخول <Icon name="arrow" />
            </Button>
            <p className="border-t border-line pt-5 text-sm leading-7 text-muted">نسيت كلمة المرور؟ تواصل مع الدعم الفني ليعيّن لك كلمة مؤقتة جديدة.</p>
          </form>
        </AuthShell>
      ) : (
        <AuthShell panelTitle="حماية إضافية لحساب مدير المنصة" panelText="حسابك بيتحكم بكل العيادات، فبنطلب منك رمز ثاني من جوالك عشان ما حدا يدخل بكلمة المرور لحالها.">
          <form onSubmit={submitCode} className="flex flex-col gap-7">
            <div className="flex flex-col gap-3">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-brand-tint text-brand">
                <Icon name="shield" size={30} />
              </div>
              <h1 className="text-3xl font-bold">التحقق بخطوتين</h1>
              <p className="text-base leading-7 text-muted">
                {useRecovery ? 'أدخل واحد من رموز الاسترداد الثمانية. كل رمز بيشتغل مرة وحدة.' : 'افتح تطبيق المصادقة على جوالك وأدخل الرمز المكوّن من 6 أرقام.'}
              </p>
            </div>
            {error && <Alert tone="error">{error}</Alert>}
            <TextField
              label={useRecovery ? 'رمز الاسترداد' : 'رمز التحقق'}
              hint={useRecovery ? 'الشكل: XXXX-XXXX' : 'الرمز بيتغيّر كل 30 ثانية.'}
              dir="ltr"
              inputMode={useRecovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              required
              autoFocus
              maxLength={useRecovery ? 12 : 6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="h-16 text-center text-2xl tracking-[0.4em]"
            />
            <Button type="submit" busy={busy} className="h-14">
              تأكيد
            </Button>
            <div className="flex flex-col items-start gap-2.5 border-t border-line pt-5 text-sm">
              <button
                type="button"
                className="cursor-pointer text-brand-dark underline"
                onClick={() => {
                  setUseRecovery(!useRecovery)
                  setCode('')
                  setError(null)
                }}
              >
                {useRecovery ? 'استخدم رمز التطبيق بدل الاسترداد' : 'استخدم رمز استرداد بدل الرمز'}
              </button>
              <button type="button" className="cursor-pointer text-brand-dark underline" onClick={backToPassword}>
                رجوع لتسجيل الدخول
              </button>
            </div>
          </form>
        </AuthShell>
      )}
    </ThemeScope>
  )
}
