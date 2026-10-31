import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { logout } from '../lib/api.ts'
import { Icon } from '../components/icons.tsx'
import type { IconName } from '../components/icons.tsx'

export interface NavItem {
  to: string
  label: string
  icon: IconName
}

/** Colored sidebar. The color comes from the active theme (Fikra blue for admin, clinic color for clinics). */
export function Sidebar({ className, header, items, footer }: { className: string; header: ReactNode; items: NavItem[]; footer?: ReactNode }) {
  return (
    <aside className={`flex flex-1 basis-[248px] flex-col gap-6 px-4 py-6 text-on-brand md:max-w-[280px] ${className}`}>
      <div className="px-2">{header}</div>
      <nav aria-label="القائمة الرئيسية" className="flex flex-col gap-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `flex items-center gap-2.5 rounded-[10px] p-3 text-[15px] ${isActive ? 'bg-(--brand-active) font-semibold' : 'hover:bg-(--brand-active)/60'}`}
          >
            <Icon name={item.icon} />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-2.5 border-t border-(--on-brand-line) px-3 pt-4">
        <button type="button" onClick={() => void logout()} className="cursor-pointer self-start text-sm underline">
          تسجيل الخروج
        </button>
        {footer}
      </div>
    </aside>
  )
}
