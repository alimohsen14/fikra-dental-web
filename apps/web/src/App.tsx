import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider, useAuth } from './auth/AuthContext.tsx'
import { homePathFor } from './auth/paths.ts'
import { RequireAuth } from './auth/RequireAuth.tsx'
import AdminLayout from './layouts/AdminLayout.tsx'
import ClinicLayout from './layouts/ClinicLayout.tsx'
import ClinicPage from './pages/admin/ClinicPage.tsx'
import ClinicsPage from './pages/admin/ClinicsPage.tsx'
import CreateClinicPage from './pages/admin/CreateClinicPage.tsx'
import BookingPage from './pages/BookingPage.tsx'
import AppointmentsPage from './pages/AppointmentsPage.tsx'
import ChangePasswordPage from './pages/ChangePasswordPage.tsx'
import HomePage from './pages/HomePage.tsx'
import HoursPage from './pages/HoursPage.tsx'
import LoginPage from './pages/LoginPage.tsx'
import { NewPatientPage, PatientPage } from './pages/PatientFormPage.tsx'
import AnalysisPage from './pages/AnalysisPage.tsx'
import ExpensesPage from './pages/ExpensesPage.tsx'
import PatientsPage from './pages/PatientsPage.tsx'
import TeamPage from './pages/TeamPage.tsx'
import SalariesPage from './pages/SalariesPage.tsx'
import SettingsPage from './pages/SettingsPage.tsx'
import { EditTreatmentPage, NewTreatmentPage } from './pages/TreatmentFormPage.tsx'
import TreatmentPage from './pages/TreatmentPage.tsx'
import TreatmentsPage from './pages/TreatmentsPage.tsx'
import TreatmentTypesPage from './pages/TreatmentTypesPage.tsx'

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
          <Route path="/book/:token" element={<BookingPage />} />
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
              <Route path="/treatments" element={<TreatmentsPage />} />
              <Route path="/treatments/:id" element={<TreatmentPage />} />
              <Route element={<RequireAuth roles={['OWNER', 'DOCTOR']} />}>
                <Route path="/treatments/new" element={<NewTreatmentPage />} />
                <Route path="/treatments/:id/edit" element={<EditTreatmentPage />} />
                <Route path="/treatment-types" element={<TreatmentTypesPage />} />
              </Route>
              <Route element={<RequireAuth roles={['OWNER']} />}>
                <Route path="/expenses" element={<ExpensesPage />} />
                <Route path="/analysis" element={<AnalysisPage />} />
                <Route path="/salaries" element={<SalariesPage />} />
                <Route path="/team" element={<TeamPage />} />
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
