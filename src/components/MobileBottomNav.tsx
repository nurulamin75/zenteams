import { NavLink, useLocation } from 'react-router-dom';
import {
  CalendarClock,
  ClipboardList,
  LayoutDashboard,
  MoreHorizontal,
  Timer,
  Settings,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

function itemClass({ isActive }: { isActive: boolean }) {
  return `mobile-nav__item${isActive ? ' mobile-nav__item--active' : ''}`;
}

export function MobileBottomNav({ onOpenMore }: { onOpenMore: () => void }) {
  const { teamId, role } = useAuth();
  const location = useLocation();
  const hasTeam = Boolean(teamId);
  const canLeadTeam = role === 'admin' || role === 'manager';
  const moreTabActive =
    location.pathname === '/analytics' ||
    location.pathname === '/history' ||
    (canLeadTeam && location.pathname === '/settings');

  if (!hasTeam) {
    return (
      <nav className="mobile-nav" aria-label="Main navigation">
        <NavLink to="/onboarding" className={itemClass}>
          <ClipboardList size={22} strokeWidth={2} aria-hidden />
          <span className="mobile-nav__label">Start</span>
        </NavLink>
        <NavLink to="/team/create" className={itemClass}>
          <Users size={22} strokeWidth={2} aria-hidden />
          <span className="mobile-nav__label">Create</span>
        </NavLink>
        <NavLink to="/team/join" className={itemClass}>
          <UserPlus size={22} strokeWidth={2} aria-hidden />
          <span className="mobile-nav__label">Join</span>
        </NavLink>
        <NavLink to="/settings" className={itemClass}>
          <Settings size={22} strokeWidth={2} aria-hidden />
          <span className="mobile-nav__label">Settings</span>
        </NavLink>
        <button
          type="button"
          className="mobile-nav__item mobile-nav__item--trigger"
          onClick={onOpenMore}
          aria-label="More options"
        >
          <MoreHorizontal size={22} strokeWidth={2} aria-hidden />
          <span className="mobile-nav__label">More</span>
        </button>
      </nav>
    );
  }

  return (
    <nav className="mobile-nav" aria-label="Main navigation">
      <NavLink to="/" end className={itemClass}>
        <LayoutDashboard size={22} strokeWidth={2} aria-hidden />
        <span className="mobile-nav__label">Home</span>
      </NavLink>
      <NavLink to="/today" className={itemClass}>
        <CalendarClock size={22} strokeWidth={2} aria-hidden />
        <span className="mobile-nav__label">Today</span>
      </NavLink>
      <NavLink to="/timesheet" className={itemClass}>
        <Timer size={22} strokeWidth={2} aria-hidden />
        <span className="mobile-nav__label">Sheet</span>
      </NavLink>
      {canLeadTeam ? (
        <NavLink to="/teams" className={itemClass}>
          <Users size={22} strokeWidth={2} aria-hidden />
          <span className="mobile-nav__label">Teams</span>
        </NavLink>
      ) : (
        <NavLink to="/settings" className={itemClass}>
          <Settings size={22} strokeWidth={2} aria-hidden />
          <span className="mobile-nav__label">Settings</span>
        </NavLink>
      )}
      <button
        type="button"
        className={`mobile-nav__item mobile-nav__item--trigger${moreTabActive ? ' mobile-nav__item--active' : ''}`}
        onClick={onOpenMore}
        aria-label="Team, reports, and sign out"
      >
        <MoreHorizontal size={22} strokeWidth={2} aria-hidden />
        <span className="mobile-nav__label">More</span>
      </button>
    </nav>
  );
}
