import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { RequireTeam } from './components/RequireTeam';
import { RequireAdmin } from './components/RequireAdmin';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Onboarding } from './pages/Onboarding';
import { CreateTeam } from './pages/CreateTeam';
import { JoinTeam } from './pages/JoinTeam';
import { Dashboard } from './pages/Dashboard';
import { Today } from './pages/Today';
import { History } from './pages/History';
import { AdminTeam } from './pages/AdminTeam';
import { Invite } from './pages/Invite';
import { Analytics } from './pages/Analytics';
import { Settings } from './pages/Settings';

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
                <Route path="settings" element={<Settings />} />
                <Route element={<RequireTeam />}>
                  <Route index element={<Dashboard />} />
                  <Route path="today" element={<Today />} />
                  <Route path="history" element={<History />} />
                </Route>
                <Route element={<RequireAdmin />}>
                  <Route path="admin" element={<AdminTeam />} />
                  <Route path="invite" element={<Invite />} />
                  <Route path="analytics" element={<Analytics />} />
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
