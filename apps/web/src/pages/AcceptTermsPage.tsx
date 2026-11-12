import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthContext.tsx'
import { homePathFor } from '../auth/paths.ts'
import { TermsText } from '../components/TermsText.tsx'
import { Alert, Button } from '../components/ui.tsx'
import { ApiError, logout } from '../lib/api.ts'
import { acceptTerms, getTerms } from '../lib/legal.ts'
import { useLoad } from '../lib/useLoad.ts'
import { ThemeScope } from '../theme/ThemeScope.tsx'

/** The clinic owner reads and accepts the terms before using the system (asked again whenever the terms change). */
export default function AcceptTermsPage() {
  const { ready, session } = useAuth()
  const navigate = useNavigate()
  const { data: doc, error: loadError } = useLoad(getTerms, [])
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!ready) return <p className="p-8 text-muted">جاري التحميل...</p>
  if (!session) return <Navigate to="/login" replace />
  if (session.mustChangePassword) return <Navigate to="/change-password" replace />
  if (!session.termsRequired) return <Navigate to={homePathFor(session.user.role)} replace />

  async function accept() {
    if (!doc) return
    setError(null)
    setBusy(true)
    try {
      await acceptTerms(doc.version)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع، حاول مرة أخرى')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ThemeScope platform>
      <div className="min-h-screen bg-[#f7fafd] px-4 py-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <img src="/brand/logo-full.png" alt="فكرة دينتال" className="h-auto w-[200px] self-start" />
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-bold">{doc?.title ?? 'شروط الاستخدام وسياسة الخصوصية'}</h1>
            <p className="text-base leading-7 text-muted">قبل البدء باستخدام النظام، يرجى قراءة الشروط التالية والموافقة عليها.</p>
          </div>
          {loadError && <Alert tone="error">{loadError}</Alert>}
          {doc && (
            <div className="max-h-[55vh] overflow-y-auto rounded-2xl border border-line bg-white p-6" tabIndex={0} aria-label="نص الشروط">
              <TermsText doc={doc} />
            </div>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-white p-4 text-base leading-7">
            <input type="checkbox" className="mt-1.5 size-5 shrink-0 cursor-pointer accent-[var(--brand)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>قرأتُ شروط الاستخدام وسياسة الخصوصية وفهمتُها، وأوافق عليها.</span>
          </label>
          <div className="flex flex-wrap items-center gap-4">
            <Button type="button" busy={busy} disabled={!agree || !doc} onClick={accept} className="h-14 px-8">
              أوافق وأتابع
            </Button>
            <button
              type="button"
              className="cursor-pointer text-brand-dark underline"
              onClick={async () => {
                await logout()
                navigate('/login', { replace: true })
              }}
            >
              لا أوافق: تسجيل الخروج
            </button>
          </div>
          <p className="text-sm text-muted">
            <Link to="/terms" className="underline">
              صفحة الشروط العامة
            </Link>
          </p>
        </div>
      </div>
    </ThemeScope>
  )
}
