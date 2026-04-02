import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function RequireManagerOrAdmin() {
  const { user, teamId, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="app-loading">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!teamId) {
    return <Navigate to="/onboarding" replace />;
  }

  if (role !== 'admin' && role !== 'manager' && role !== 'auditor') {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
