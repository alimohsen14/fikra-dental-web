import { Link } from 'react-router'
import { TermsText } from '../components/TermsText.tsx'
import { Alert } from '../components/ui.tsx'
import { getTerms } from '../lib/legal.ts'
import { useLoad } from '../lib/useLoad.ts'
import { ThemeScope } from '../theme/ThemeScope.tsx'

/** The terms, readable by anyone (linked from the login page and from the settings). */
export default function TermsPage() {
  const { data: doc, error } = useLoad(getTerms, [])
  return (
    <ThemeScope platform>
      <div className="min-h-screen bg-[#f7fafd] px-4 py-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <img src="/brand/logo-full.png" alt="فكرة دينتال" className="h-auto w-[200px] self-start" />
          <h1 className="text-3xl font-bold">{doc?.title ?? 'شروط الاستخدام وسياسة الخصوصية'}</h1>
          {error && <Alert tone="error">{error}</Alert>}
          {doc && (
            <div className="rounded-2xl border border-line bg-white p-6">
              <TermsText doc={doc} />
            </div>
          )}
          <Link to="/" className="text-brand-dark underline">
            رجوع
          </Link>
        </div>
      </div>
    </ThemeScope>
  )
}
