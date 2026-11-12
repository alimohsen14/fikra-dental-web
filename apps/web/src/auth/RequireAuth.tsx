import { Navigate, Outlet } from 'react-router'
import { useAuth } from './AuthContext.tsx'
import { homePathFor } from './paths.ts'
import type { Role } from '../lib/session.ts'

/**
 * Wraps the pages that need a login. `roles`: who may see them (the server checks this again on
 * every request: this only decides what the screen shows).
 */
export function RequireAuth({ roles }: { roles?: Role[] }) {
  const { ready, session } = useAuth()
  if (!ready) return <p className="p-8 text-muted">جاري التحميل...</p>
  if (!session) return <Navigate to="/login" replace />
  if (session.mustChangePassword) return <Navigate to="/change-password" replace />
  if (session.termsRequired) return <Navigate to="/accept-terms" replace />
  if (roles && !roles.includes(session.user.role)) return <Navigate to={homePathFor(session.user.role)} replace />
  return <Outlet />
}
