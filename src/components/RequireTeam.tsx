import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function RequireTeam() {
  const { user, teamId, loading } = useAuth();

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

  return <Outlet />;
}
