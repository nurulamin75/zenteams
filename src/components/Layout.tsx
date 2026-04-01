import { useEffect, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { MobileBottomNav } from './MobileBottomNav';
import { MobileMoreMenu } from './MobileMoreMenu';
import { Sidebar } from './Sidebar';

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

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
        open={false}
        onClose={() => {}}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
      />
      <div className="app-main">
        <header className="app-topbar">
          <span className="app-topbar-brand">ZenTeams</span>
        </header>
        <div
          className={`app-content${userPreferences?.compactUI ? ' app-content--compact' : ''}`}
        >
          <Outlet />
        </div>
      </div>
      <MobileBottomNav onOpenMore={() => setMobileMoreOpen(true)} />
      <MobileMoreMenu open={mobileMoreOpen} onClose={() => setMobileMoreOpen(false)} />
    </div>
  );
}
