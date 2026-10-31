import { Outlet } from 'react-router'
import { useAuth } from '../auth/AuthContext.tsx'
import { ThemeScope } from '../theme/ThemeScope.tsx'
import { Sidebar } from './Sidebar.tsx'
import type { NavItem } from './Sidebar.tsx'

const ITEMS: NavItem[] = [{ to: '/admin', label: 'العيادات', icon: 'clinics' }]

export default function AdminLayout() {
  const { session } = useAuth()
  return (
    <ThemeScope platform>
      <div className="flex min-h-screen flex-wrap bg-page">
        <Sidebar
          className="fikra-side"
          items={ITEMS}
          header={
            <div className="flex flex-col gap-2">
              <div className="self-start rounded-xl bg-white px-3 py-2">
                <img src="/brand/logo-full.png" alt="فكرة دينتال" className="block h-auto w-[150px]" />
              </div>
              <span className="text-xs text-on-brand-soft">{session?.user.fullName} · مدير المنصة</span>
            </div>
          }
        />
        <main className="flex min-w-0 flex-[999_1_560px] flex-col gap-5 p-8">
          <Outlet />
        </main>
      </div>
    </ThemeScope>
  )
}
