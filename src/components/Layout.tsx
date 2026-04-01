import { useEffect, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { MobileMenuButton, Sidebar } from './Sidebar';

const SIDEBAR_COLLAPSED_KEY = 'zenteams-sidebar-collapsed';

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function Layout() {
  const { user, loading, userPreferences } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  if (loading && !user) {
    return (
      <div className="app-loading">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="auth-shell">
        <Link to="/login" className="auth-logo">
          ZenTeams
        </Link>
        <Outlet />
      </div>
    );
  }

  return (
    <div className={`app-shell${sidebarCollapsed ? ' app-shell--sidebar-collapsed' : ''}`}>
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
      />
      <div className="app-main">
        <header className="app-topbar">
          <MobileMenuButton onClick={() => setSidebarOpen(true)} />
          <div className="app-topbar-spacer" />
        </header>
        <div
          className={`app-content${userPreferences?.compactUI ? ' app-content--compact' : ''}`}
        >
          <Outlet />
        </div>
      </div>
    </div>
  );
}
