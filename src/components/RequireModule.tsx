import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { AppModule } from '../types';

export function RequireModule({ module }: { module: AppModule }) {
  const { loading, user, teamId, canAccessModule, permissionFallbackPath } = useAuth();

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

  if (!canAccessModule(module)) {
    return <Navigate to={permissionFallbackPath} replace />;
  }

  return <Outlet />;
}
