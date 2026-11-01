import { Outlet } from 'react-router'
import { useAuth } from '../auth/AuthContext.tsx'
import { daysLabel, ROLE_LABELS } from '../auth/paths.ts'
import { Alert } from '../components/ui.tsx'
import { canEditTreatments, canSeeTreatments } from '../lib/access.ts'
import { assetUrl } from '../lib/api.ts'
import { Icon } from '../components/icons.tsx'
import { ThemeScope } from '../theme/ThemeScope.tsx'
import { Sidebar } from './Sidebar.tsx'
import type { NavItem } from './Sidebar.tsx'

const ITEMS: NavItem[] = [
  { to: '/home', label: 'الرئيسية', icon: 'home' },
  { to: '/appointments', label: 'المواعيد', icon: 'calendar' },
  { to: '/patients', label: 'المرضى', icon: 'patients' },
]
const TREATMENT_ITEM: NavItem = { to: '/treatments', label: 'العلاجات', icon: 'tooth' }
const TYPES_ITEM: NavItem = { to: '/treatment-types', label: 'أنواع العلاج', icon: 'types' }
const OWNER_ITEMS: NavItem[] = [
  { to: '/team', label: 'الفريق', icon: 'team' },
  { to: '/hours', label: 'أوقات الدوام', icon: 'clock' },
  { to: '/settings', label: 'الإعدادات', icon: 'settings' },
]

export default function ClinicLayout() {
  const { session } = useAuth()
  if (!session) return null
  const { clinic, user, subscriptionWarning } = session
  const name = clinic?.name ?? 'العيادة'
  return (
    <ThemeScope color={clinic?.themeColor}>
      <div className="flex min-h-screen flex-wrap bg-[#f6f8fa]">
        <Sidebar
          className="bg-brand"
          items={[...ITEMS, ...(canSeeTreatments(user) ? [TREATMENT_ITEM] : []), ...(canEditTreatments(user) ? [TYPES_ITEM] : []), ...(user.role === 'OWNER' ? OWNER_ITEMS : [])]}
          header={
            <div className="flex items-center gap-2.5">
              {clinic?.logoUrl ? (
                <img src={assetUrl(clinic.logoUrl)} alt="" className="size-[46px] rounded-xl bg-white object-contain" />
              ) : (
                <span className="inline-flex size-[46px] items-center justify-center rounded-xl bg-on-brand text-[22px] font-bold text-brand">{name.charAt(0)}</span>
              )}
              <div className="flex flex-col leading-snug">
                <span className="text-[17px] font-bold">{name}</span>
                <span className="text-xs text-on-brand-soft">
                  {user.fullName} · {ROLE_LABELS[user.role]}
                </span>
              </div>
            </div>
          }
          footer={
            <div className="flex items-center gap-2 text-xs text-on-brand-soft">
              <span className="inline-flex size-7 items-center justify-center rounded-lg bg-white">
                <img src="/brand/logo-icon.png" alt="" className="h-[18px] w-auto" />
              </span>
              مدعوم من فكرة دينتال
            </div>
          }
        />
        <main className="flex min-w-0 flex-[999_1_560px] flex-col gap-5 p-4 md:p-8">
          {subscriptionWarning && (
            <Alert tone="warning">
              <span className="flex items-start gap-3">
                <span className="mt-1 shrink-0">
                  <Icon name="warning" />
                </span>
                <span>
                  <strong>انتهى اشتراك عيادتك.</strong> باقي لك {daysLabel(subscriptionWarning.graceDaysLeft)} قبل ما يتوقف الدخول لكل الموظفين. تواصل مع الدعم لتجديد الاشتراك.
                </span>
              </span>
            </Alert>
          )}
          <Outlet />
        </main>
      </div>
    </ThemeScope>
  )
}
