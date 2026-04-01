import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { BarChart3, LogOut, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { TeamSwitcher } from './TeamSwitcher';

export function MobileMoreMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { teamId, teamName, teams, role, logout, switchTeam } = useAuth();
  const hasTeam = Boolean(teamId);
  const canLeadTeam = role === 'admin' || role === 'manager';

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  async function handleLogout() {
    onClose();
    await logout();
  }

  return (
    <>
      <button
        type="button"
        className="mobile-more-backdrop"
        aria-label="Close menu"
        onClick={onClose}
      />
      <div className="mobile-more-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-more-title">
        <div className="mobile-more-sheet__grab" aria-hidden />
        <h2 id="mobile-more-title" className="mobile-more-sheet__title">
          More
        </h2>

        {hasTeam && teamName && teamId && (
          <div className="mobile-more-sheet__block">
            <p className="mobile-more-sheet__eyebrow">Team</p>
            <TeamSwitcher
              teams={teams.length > 0 ? teams : [{ id: teamId, name: teamName }]}
              activeTeamId={teamId}
              collapsed={false}
              onSelect={(id) => {
                void switchTeam(id).then(() => onClose());
              }}
            />
          </div>
        )}

        {hasTeam && canLeadTeam && (
          <div className="mobile-more-sheet__links">
            <NavLink to="/teams" className="mobile-more-sheet__link" onClick={onClose}>
              <Users size={20} strokeWidth={2} aria-hidden />
              Teams
            </NavLink>
            <NavLink to="/analytics" className="mobile-more-sheet__link" onClick={onClose}>
              <BarChart3 size={20} strokeWidth={2} aria-hidden />
              Analytics
            </NavLink>
          </div>
        )}

        <div className="mobile-more-sheet__footer">
          <button type="button" className="mobile-more-sheet__logout" onClick={() => void handleLogout()}>
            <LogOut size={20} strokeWidth={2} aria-hidden />
            Sign out
          </button>
        </div>
      </div>
    </>
  );
}
