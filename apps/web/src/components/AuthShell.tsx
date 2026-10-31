import type { ReactNode } from 'react'
import { Icon } from './icons.tsx'

/** Login-style page: wide blue panel with the logo on one side, the form on the other. */
export function AuthShell({
  panelTitle,
  panelText,
  features,
  children,
}: {
  panelTitle: string
  panelText: string
  features?: string[]
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-wrap bg-white">
      <section className="fikra-panel relative flex min-h-[320px] flex-1 basis-[520px] flex-col justify-between gap-10 overflow-hidden p-8 text-white md:p-14">
        <div aria-hidden="true" className="absolute left-10 top-10 grid grid-cols-4 gap-2 opacity-35">
          {[0, 5, 10, 15].map((i) => (
            <span key={i} style={{ gridColumnStart: (i % 4) + 1, gridRowStart: Math.floor(i / 4) + 1 }} className="size-[22px] bg-[#3fd0fb]" />
          ))}
        </div>
        <div className="self-start rounded-2xl bg-white px-5 py-3.5 shadow-xl shadow-[#033264]/35">
          <img src="/brand/logo-full.png" alt="فكرة دينتال" className="block h-auto w-[260px] max-w-full" />
        </div>
        <div className="flex max-w-[460px] flex-col gap-5">
          <h2 className="text-3xl leading-snug font-bold md:text-4xl">{panelTitle}</h2>
          <p className="text-[17px] leading-8 text-[#e6f0fb]">{panelText}</p>
          {features && (
            <ul className="mt-2 flex flex-col gap-3 text-base">
              {features.map((f) => (
                <li key={f} className="flex items-center gap-2.5">
                  <span className="text-[#7fe0ff]">
                    <Icon name="check" size={22} strokeWidth={2.2} />
                  </span>
                  {f}
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-sm text-[#cfe3f8]">من الفكرة إلى الواقع الرقمي</p>
      </section>

      <section className="flex flex-1 basis-[480px] items-center justify-center bg-[#f7fafd] px-8 py-12">
        <div className="flex w-full max-w-[400px] flex-col gap-7">{children}</div>
      </section>
    </div>
  )
}
