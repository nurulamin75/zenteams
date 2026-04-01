import { NavLink } from 'react-router-dom';
import {
  BarChart3,
  CalendarClock,
  ClipboardList,
  History,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { TeamSwitcher } from './TeamSwitcher';

export function Sidebar({
  open,
  onClose,
  collapsed,
  onToggleCollapsed,
}: {
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const { teamId, teamName, teams, role, logout, switchTeam } = useAuth();
  const hasTeam = Boolean(teamId);
  const canLeadTeam = role === 'admin' || role === 'manager';

  async function handleLogout() {
    onClose();
    await logout();
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `sidebar-link${isActive ? ' sidebar-link--active' : ''}`;

  return (
    <>
      <button
        type="button"
        className="sidebar-backdrop"
        aria-label="Close menu"
        data-open={open}
        onClick={onClose}
      />
      <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`} data-open={open}>
        <div className="sidebar-brand-row">
          <div className="sidebar-brand">
            <Layers className="sidebar-brand-icon" size={22} strokeWidth={2} />
            {!collapsed && <span className="sidebar-brand-text">ZenTeams</span>}
          </div>
          <button
            type="button"
            className="sidebar-collapse-toggle"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={20} strokeWidth={2} /> : <PanelLeftClose size={20} strokeWidth={2} />}
          </button>
        </div>

        {hasTeam && teamName && (
          <div className="sidebar-team-wrap">
            <TeamSwitcher
              teams={teams.length > 0 ? teams : [{ id: teamId!, name: teamName }]}
              activeTeamId={teamId}
              collapsed={collapsed}
              onSelect={(id) => void switchTeam(id).then(() => onClose())}
            />
          </div>
        )}

        <nav className="sidebar-nav">
          {hasTeam ? (
            <>
              <NavLink to="/" end className={linkClass} onClick={onClose} title="Dashboard">
                <LayoutDashboard size={20} strokeWidth={2} />
                <span className="sidebar-link-text">Dashboard</span>
              </NavLink>
              <NavLink to="/today" className={linkClass} onClick={onClose} title="Attendance">
                <CalendarClock size={20} strokeWidth={2} />
                <span className="sidebar-link-text">Attendance</span>
              </NavLink>
              <NavLink to="/history" className={linkClass} onClick={onClose} title="History">
                <History size={20} strokeWidth={2} />
                <span className="sidebar-link-text">History</span>
              </NavLink>
              {canLeadTeam && (
                <>
                  <NavLink to="/teams" className={linkClass} onClick={onClose} title="Teams">
                    <Users size={20} strokeWidth={2} />
                    <span className="sidebar-link-text">Teams</span>
                  </NavLink>
                  <NavLink to="/analytics" className={linkClass} onClick={onClose} title="Analytics">
                    <BarChart3 size={20} strokeWidth={2} />
                    <span className="sidebar-link-text">Analytics</span>
                  </NavLink>
                </>
              )}
            </>
          ) : (
            <>
              <NavLink to="/onboarding" className={linkClass} onClick={onClose} title="Get started">
                <ClipboardList size={20} strokeWidth={2} />
                <span className="sidebar-link-text">Get started</span>
              </NavLink>
              <NavLink to="/team/create" className={linkClass} onClick={onClose} title="Create team">
                <Users size={20} strokeWidth={2} />
                <span className="sidebar-link-text">Create team</span>
              </NavLink>
              <NavLink to="/team/join" className={linkClass} onClick={onClose} title="Join team">
                <UserPlus size={20} strokeWidth={2} />
                <span className="sidebar-link-text">Join team</span>
              </NavLink>
            </>
          )}
          <NavLink to="/settings" className={linkClass} onClick={onClose} title="Settings">
            <Settings size={20} strokeWidth={2} />
            <span className="sidebar-link-text">Settings</span>
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-logout"
            onClick={() => void handleLogout()}
            title="Sign out"
          >
            <LogOut size={18} strokeWidth={2} />
            <span className="sidebar-link-text">Sign out</span>
          </button>
        </div>
      </aside>
    </>
  );
}

export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="mobile-menu-btn" aria-label="Open menu" onClick={onClick}>
      <Menu size={22} strokeWidth={2} />
    </button>
  );
}
