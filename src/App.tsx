import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { RequireTeam } from './components/RequireTeam';
import { RequireManagerOrAdmin } from './components/RequireManagerOrAdmin';
import { RequireModule } from './components/RequireModule';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Onboarding } from './pages/Onboarding';
import { CreateTeam } from './pages/CreateTeam';
import { JoinTeam } from './pages/JoinTeam';
import { Dashboard } from './pages/Dashboard';
import { Today } from './pages/Today';
import { History } from './pages/History';
import { Teams } from './pages/Teams';
import { Analytics } from './pages/Analytics';
import { Settings } from './pages/Settings';
import { Timesheet } from './pages/Timesheet';
import { Calendar } from './pages/Calendar';
import { Reports } from './pages/Reports';
import { Projects } from './pages/Projects';

function SettingsWithPermission() {
  const { teamId, canAccessModule, permissionFallbackPath } = useAuth();
  if (teamId && !canAccessModule('settings')) {
    return <Navigate to={permissionFallbackPath} replace />;
  }
  return <Settings />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route path="login" element={<Login />} />
              <Route path="register" element={<Register />} />
              <Route element={<RequireAuth />}>
                <Route path="onboarding" element={<Onboarding />} />
                <Route path="team/create" element={<CreateTeam />} />
                <Route path="team/join" element={<JoinTeam />} />
                <Route path="settings" element={<SettingsWithPermission />} />
                <Route element={<RequireTeam />}>
                  <Route element={<RequireModule module="dashboard" />}>
                    <Route index element={<Dashboard />} />
                  </Route>
                  <Route element={<RequireModule module="attendance" />}>
                    <Route path="today" element={<Today />} />
                    <Route path="history" element={<History />} />
                  </Route>
                  <Route element={<RequireModule module="timesheet" />}>
                    <Route path="timesheet" element={<Timesheet />} />
                  </Route>
                  <Route element={<RequireModule module="calendar" />}>
                    <Route path="calendar" element={<Calendar />} />
                  </Route>
                  <Route element={<RequireModule module="projects" />}>
                    <Route path="projects" element={<Projects />} />
                  </Route>
                </Route>
                <Route element={<RequireManagerOrAdmin />}>
                  <Route element={<RequireModule module="teams" />}>
                    <Route path="teams" element={<Teams />} />
                    <Route path="admin" element={<Navigate to="/teams" replace />} />
                    <Route path="invite" element={<Navigate to="/teams" replace />} />
                  </Route>
                  <Route element={<RequireModule module="analytics" />}>
                    <Route path="analytics" element={<Analytics />} />
                  </Route>
                  <Route element={<RequireModule module="reports" />}>
                    <Route path="reports" element={<Reports />} />
                  </Route>
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
