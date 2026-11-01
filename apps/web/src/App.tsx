import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider, useAuth } from './auth/AuthContext.tsx'
import { homePathFor } from './auth/paths.ts'
import { RequireAuth } from './auth/RequireAuth.tsx'
import AdminLayout from './layouts/AdminLayout.tsx'
import ClinicLayout from './layouts/ClinicLayout.tsx'
import ClinicPage from './pages/admin/ClinicPage.tsx'
import ClinicsPage from './pages/admin/ClinicsPage.tsx'
import CreateClinicPage from './pages/admin/CreateClinicPage.tsx'
import AppointmentsPage from './pages/AppointmentsPage.tsx'
import ChangePasswordPage from './pages/ChangePasswordPage.tsx'
import HomePage from './pages/HomePage.tsx'
import HoursPage from './pages/HoursPage.tsx'
import LoginPage from './pages/LoginPage.tsx'
import { NewPatientPage, PatientPage } from './pages/PatientFormPage.tsx'
import PatientsPage from './pages/PatientsPage.tsx'
import SettingsPage from './pages/SettingsPage.tsx'

function HomeRedirect() {
  const { ready, session } = useAuth()
  if (!ready) return <p className="p-8 text-muted">جاري التحميل...</p>
  if (!session) return <Navigate to="/login" replace />
  if (session.mustChangePassword) return <Navigate to="/change-password" replace />
  return <Navigate to={homePathFor(session.user.role)} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route element={<RequireAuth roles={['PLATFORM_ADMIN']} />}>
            <Route element={<AdminLayout />}>
              <Route path="/admin" element={<ClinicsPage />} />
              <Route path="/admin/clinics/new" element={<CreateClinicPage />} />
              <Route path="/admin/clinics/:id" element={<ClinicPage />} />
            </Route>
          </Route>
          <Route element={<RequireAuth roles={['OWNER', 'DOCTOR', 'SECRETARY']} />}>
            <Route element={<ClinicLayout />}>
              <Route path="/home" element={<HomePage />} />
              <Route path="/appointments" element={<AppointmentsPage />} />
              <Route path="/patients" element={<PatientsPage />} />
              <Route path="/patients/new" element={<NewPatientPage />} />
              <Route path="/patients/:id" element={<PatientPage />} />
              <Route element={<RequireAuth roles={['OWNER']} />}>
                <Route path="/hours" element={<HoursPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<HomeRedirect />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
