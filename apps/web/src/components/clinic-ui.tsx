import type { ReactNode } from 'react'
import { Link } from 'react-router'

/** Page header in the clinic's own color. */
export function ClinicBanner({ title, subtitle, back, action }: { title: string; subtitle?: string; back?: { to: string; label: string }; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-brand p-7 text-on-brand">
      <div className="flex flex-col gap-1">
        {back && (
          <Link to={back.to} className="text-sm underline">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-3xl font-bold">{title}</h1>
        {subtitle && <p className="text-[15px] text-on-brand-soft">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

/** Button-looking link on a colored banner (inverted colors). */
export function BannerLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex h-12 items-center gap-2 rounded-xl bg-on-brand px-5 font-bold text-brand">
      {children}
    </Link>
  )
}
