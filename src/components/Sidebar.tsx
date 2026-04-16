import { NavLink } from 'react-router-dom';
import {
  BarChart3,
  Briefcase,
  CalendarClock,
  CalendarRange,
  ClipboardList,
  FileBarChart,
  Layers,
  Timer,
  LayoutDashboard,
  LogOut,
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
  const { teamId, teamName, teams, role, logout, switchTeam, canAccessModule } = useAuth();
  const hasTeam = Boolean(teamId);
  const canLeadTeam = role === 'admin' || role === 'manager' || role === 'auditor';

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
              {canAccessModule('dashboard') && (
                <NavLink to="/" end className={linkClass} onClick={onClose} title="Dashboard">
                  <LayoutDashboard size={20} strokeWidth={2} />
                  <span className="sidebar-link-text">Dashboard</span>
                </NavLink>
              )}
              {canAccessModule('attendance') && (
                <NavLink to="/today" className={linkClass} onClick={onClose} title="Attendance">
                  <CalendarClock size={20} strokeWidth={2} />
                  <span className="sidebar-link-text">Attendance</span>
                </NavLink>
              )}
              {canAccessModule('timesheet') && (
                <NavLink to="/timesheet" className={linkClass} onClick={onClose} title="Timesheet">
                  <Timer size={20} strokeWidth={2} />
                  <span className="sidebar-link-text">Timesheet</span>
                </NavLink>
              )}
              {canAccessModule('calendar') && (
                <NavLink to="/calendar" className={linkClass} onClick={onClose} title="Calendar">
                  <CalendarRange size={20} strokeWidth={2} />
                  <span className="sidebar-link-text">Calendar</span>
                </NavLink>
              )}
              {canAccessModule('projects') && (
                <NavLink to="/projects" className={linkClass} onClick={onClose} title="Projects">
                  <Briefcase size={20} strokeWidth={2} />
                  <span className="sidebar-link-text">Projects</span>
                </NavLink>
              )}
              {canLeadTeam && canAccessModule('teams') && (
                <NavLink to="/teams" className={linkClass} onClick={onClose} title="Teams">
                  <Users size={20} strokeWidth={2} />
                  <span className="sidebar-link-text">Teams</span>
                </NavLink>
              )}
              {canLeadTeam && canAccessModule('analytics') && (
                <NavLink to="/analytics" className={linkClass} onClick={onClose} title="Analytics">
                  <BarChart3 size={20} strokeWidth={2} />
                  <span className="sidebar-link-text">Analytics</span>
                </NavLink>
              )}
              {canLeadTeam && canAccessModule('reports') && (
                <NavLink to="/reports" className={linkClass} onClick={onClose} title="Reports">
                  <FileBarChart size={20} strokeWidth={2} />
                  <span className="sidebar-link-text">Reports</span>
                </NavLink>
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
          {(!hasTeam || canAccessModule('settings')) && (
            <NavLink to="/settings" className={linkClass} onClick={onClose} title="Settings">
              <Settings size={20} strokeWidth={2} />
              <span className="sidebar-link-text">Settings</span>
            </NavLink>
          )}
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

