import { useId } from 'react'
import type { ChangeEvent } from 'react'
import { toLatinDigits } from '../lib/format.ts'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

export function Button({
  variant = 'primary',
  size = 'md',
  busy,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger'; size?: 'md' | 'sm'; busy?: boolean }) {
  const base = `inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
    size === 'sm' ? 'h-10 px-4 text-sm' : 'h-13 px-6 text-[17px]'
  }`
  const look =
    variant === 'primary'
      ? 'bg-brand text-on-brand shadow-lg shadow-brand/25 hover:brightness-110'
      : variant === 'danger'
        ? 'bg-[#b42318] text-white hover:brightness-110'
        : 'border border-line bg-white text-ink hover:bg-page'
  return (
    <button className={`${base} ${look} ${className}`} disabled={busy || rest.disabled} {...rest}>
      {busy ? 'لحظة...' : children}
    </button>
  )
}

export function TextField({ label, hint, icon, className = '', ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; icon?: ReactNode }) {
  const id = useId()
  // Numbers, phones and searches accept Arabic digits too: they are turned into 0-9 as they are typed or pasted.
  const numeric = rest.inputMode === 'numeric' || rest.inputMode === 'decimal' || rest.inputMode === 'tel' || rest.type === 'search'
  const onChange =
    numeric && rest.onChange
      ? (e: ChangeEvent<HTMLInputElement>) => {
          const latin = toLatinDigits(e.target.value)
          if (latin !== e.target.value) e.target.value = latin
          rest.onChange!(e)
        }
      : rest.onChange
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div className="relative">
        {icon && <span className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-muted">{icon}</span>}
        <input
          id={id}
          className={`h-13 w-full rounded-xl border-[1.5px] border-[#b4c4d8] bg-white pe-3.5 text-base text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/25 ${icon ? 'ps-11' : 'ps-3.5'} ${className}`}
          {...rest}
          onChange={onChange}
        />
      </div>
      {hint && <p className="text-[13px] text-muted">{hint}</p>}
    </div>
  )
}

export function Alert({ tone, children }: { tone: 'error' | 'warning' | 'success'; children: ReactNode }) {
  const look =
    tone === 'error'
      ? 'border-[#f2b8b8] bg-[#fde8e8] text-[#7a1212]'
      : tone === 'success'
        ? 'border-[#a9dcc0] bg-[#e3f5ea] text-[#0b4f2c]'
        : 'border-[#f0cf8f] bg-[#fff1d6] text-[#5c3600]'
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm leading-7 ${look}`}>
      {children}
    </div>
  )
}

export function SelectField({ label, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <select
        id={id}
        className="h-13 w-full rounded-xl border-[1.5px] border-[#b4c4d8] bg-white px-3 text-base text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
        {...rest}
      >
        {children}
      </select>
    </div>
  )
}

export function TextAreaField({ label, hint, className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        className={`w-full rounded-xl border-[1.5px] border-[#b4c4d8] bg-white px-3.5 py-3 text-base text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/25 ${className}`}
        {...rest}
      />
      {hint && <p className="text-[13px] text-muted">{hint}</p>}
    </div>
  )
}
