import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { ClinicState } from '../lib/admin.ts'
import { formatDate, formatMoney } from '../lib/format.ts'
import { COLOR_PRESETS, STATE_STYLE } from './admin-style.ts'
import { Button } from './ui.tsx'

/** Gradient page header (Fikra blue). `back` = link back to the parent screen. */
export function PageBanner({ title, subtitle, back, action }: { title: string; subtitle?: string; back?: { to: string; label: string }; action?: ReactNode }) {
  return (
    <div className="fikra-banner flex flex-wrap items-center justify-between gap-4 rounded-2xl p-7 text-white">
      <div className="flex flex-col gap-1">
        {back && (
          <Link to={back.to} className="text-sm text-white underline">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-3xl font-bold">{title}</h1>
        {subtitle && <p className="text-[15px] text-[#e6f0fb]">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function Card({ title, hint, children, id }: { title?: string; hint?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-6">
      {(title || hint) && (
        <div className="flex flex-col gap-1">
          {title && <h2 className="text-lg font-bold">{title}</h2>}
          {hint && <p className="text-sm leading-7 text-muted">{hint}</p>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Badge({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span style={{ background: bg, color: fg }} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold whitespace-nowrap">
      <span style={{ background: fg }} className="size-2 rounded-full" />
      {label}
    </span>
  )
}

export const StateBadge = ({ state }: { state: ClinicState }) => <Badge {...STATE_STYLE[state]} />

/** Money always reads left-to-right, even inside Arabic text. */
export const Money = ({ agorot }: { agorot: number }) => (
  <bdi dir="ltr" className="whitespace-nowrap">
    {formatMoney(agorot)}
  </bdi>
)

export const DateText = ({ value }: { value: string | Date | null | undefined }) => (
  <bdi dir="ltr" className="whitespace-nowrap">
    {formatDate(value)}
  </bdi>
)

export function Loading({ error }: { error?: string | null }) {
  return error ? (
    <div role="alert" className="rounded-xl border border-[#f2b8b8] bg-[#fde8e8] p-4 text-sm text-[#7a1212]">
      {error}
    </div>
  ) : (
    <p className="text-muted">جاري التحميل...</p>
  )
}

/** Round color swatches. value = null means "the default color". */
export function ColorPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const options = value && !COLOR_PRESETS.some((c) => c.value === value) ? [...COLOR_PRESETS, { value, name: 'لون مخصص' }] : COLOR_PRESETS
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold">لون العيادة</span>
      <div className="flex flex-wrap gap-2.5">
        {options.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-label={c.name}
            aria-pressed={(value ?? '').toLowerCase() === c.value}
            onClick={() => onChange(c.value)}
            style={{ background: c.value }}
            className={`size-10 cursor-pointer rounded-full border-[3px] border-white ${(value ?? '').toLowerCase() === c.value ? 'ring-2 ring-ink' : 'ring-1 ring-[#b9c7d9]'}`}
          />
        ))}
      </div>
    </div>
  )
}

/** The temporary password. It is shown here once: the server cannot show it again. */
export function SecretBox({ title, username, password, expiresAt }: { title: string; username: string; password: string; expiresAt: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
    } catch {
      setCopied(false) // the password stays on screen to copy by hand
    }
  }
  return (
    <section aria-label={title} className="flex flex-col gap-4 rounded-2xl border-2 border-[#0b6b3a] bg-white p-6">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="flex flex-col gap-1">
        <span className="text-[13px] text-muted">اسم المستخدم</span>
        <bdi dir="ltr" className="text-[17px] font-semibold">
          {username}
        </bdi>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted">كلمة المرور المؤقتة</span>
        <div className="flex flex-wrap items-center gap-2.5">
          <bdi dir="ltr" data-testid="temp-password" className="flex-1 basis-40 rounded-xl bg-page px-3.5 py-2.5 text-center text-xl font-bold tracking-wide select-all">
            {password}
          </bdi>
          <Button type="button" variant="secondary" size="sm" onClick={() => void copy()}>
            {copied ? 'تم النسخ ✓' : 'نسخ'}
          </Button>
        </div>
      </div>
      <p className="rounded-xl bg-[#fff1d6] px-3.5 py-3 text-sm leading-7 text-[#5c3600]">
        انسخها الآن وأرسلها للمالك. <strong>ما رح تظهر مرة تانية.</strong> صالحة لغاية <DateText value={expiresAt} />، وبيغيّرها أول ما يدخل.
      </p>
    </section>
  )
}
