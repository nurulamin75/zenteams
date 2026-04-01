import { Navigate, Link } from 'react-router-dom';
import { Users, UserPlus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export function Onboarding() {
  const { user, teamId, loading } = useAuth();

  if (loading) {
    return (
      <div className="centered muted">
        <p>Loading…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (teamId) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Welcome</h1>
        <p className="page-sub">
          Create a new team or join one you were invited to. Admins see the <strong>invite code</strong>,{' '}
          <strong>team ID</strong>, and <strong>join link</strong> on their Dashboard after creating the team.
        </p>
      </header>
      <div className="card">
        <div className="onboarding-actions">
          <Link to="/team/create" className="button primary">
            <Users size={20} strokeWidth={2} />
            Create team
          </Link>
          <Link to="/team/join" className="button secondary">
            <UserPlus size={20} strokeWidth={2} />
            Join team
          </Link>
        </div>
        <p className="muted small" style={{ marginTop: '1.25rem', marginBottom: 0 }}>
          After you join, use <strong>Settings</strong> in the sidebar to set your name and theme.
        </p>
      </div>
    </div>
  );
}
