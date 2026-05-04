import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import { Toaster } from 'sonner';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { SignUpPage } from './pages/SignUpPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { HelpPage } from './pages/HelpPage';
import { AdminHomePage } from './pages/admin/AdminHomePage';
import { UploadRegulationPage } from './pages/admin/UploadRegulationPage';
import { AdminSettingsPage } from './pages/admin/AdminSettingsPage';
import { AdminProfilePage } from './pages/admin/AdminProfilePage';
import { EmployeeDirectoryPage } from './pages/admin/EmployeeDirectoryPage';
import { UploadEmployeeFacesPage } from './pages/admin/UploadEmployeeFacesPage';
import { MonitorAccessPermissionPage } from './pages/admin/MonitorAccessPermissionPage';
import { AdminAlertsHistoryPage } from './pages/admin/AdminAlertsHistoryPage';
import { SupervisorHomePage } from './pages/supervisor/SupervisorHomePage';
import { MonitoringPage } from './pages/supervisor/MonitoringPage';
import { SupervisorAlertsHistoryPage } from './pages/supervisor/SupervisorAlertsHistoryPage';
import { SupervisorSettingsPage } from './pages/supervisor/SupervisorSettingsPage';
import { SupervisorProfilePage } from './pages/supervisor/SupervisorProfilePage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/help" element={<HelpPage />} />

        <Route
          element={
            <ProtectedRoute allowedRoles={['admin']} />
          }
        >
          <Route path="/admin" element={<AdminHomePage />} />
          <Route path="/admin/upload-regulation" element={<UploadRegulationPage />} />
          <Route path="/admin/monitoring" element={<MonitoringPage />} />
          <Route path="/admin/settings" element={<AdminSettingsPage />} />
          <Route path="/admin/profile" element={<AdminProfilePage />} />
          <Route path="/admin/employees" element={<EmployeeDirectoryPage />} />
          <Route path="/admin/upload-faces" element={<UploadEmployeeFacesPage />} />
          <Route path="/admin/supervisors" element={<MonitorAccessPermissionPage />} />
          <Route path="/admin/monitor-access" element={<MonitorAccessPermissionPage />} />
          <Route path="/admin/alerts-history" element={<AdminAlertsHistoryPage />} />
        </Route>

        <Route element={<ProtectedRoute allowedRoles={['supervisor']} />}>
          <Route path="/supervisor" element={<SupervisorHomePage />} />
          <Route path="/supervisor/monitoring" element={<MonitoringPage />} />
          <Route path="/supervisor/alerts-history" element={<SupervisorAlertsHistoryPage />} />
          <Route path="/supervisor/settings" element={<SupervisorSettingsPage />} />
          <Route path="/supervisor/profile" element={<SupervisorProfilePage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster position="top-center" richColors />
    </BrowserRouter>
  );
}
