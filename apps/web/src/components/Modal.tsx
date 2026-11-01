import { useEffect, useId } from 'react'
import type { ReactNode } from 'react'

/** Simple centered dialog: Escape or a click outside closes it. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const id = useId()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={id} className="my-8 flex w-full max-w-xl flex-col gap-5 rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <h2 id={id} className="text-xl font-bold">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="size-9 cursor-pointer rounded-lg text-2xl leading-none text-muted hover:bg-page">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
