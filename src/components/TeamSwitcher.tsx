import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { TeamAvatar } from './TeamAvatar';
import type { UserTeam } from '../types';

export function TeamSwitcher({
  teams,
  activeTeamId,
  onSelect,
  collapsed,
}: {
  teams: UserTeam[];
  activeTeamId: string | null;
  onSelect: (teamId: string) => void | Promise<void>;
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = teams.find((t) => t.id === activeTeamId) ?? teams[0];

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open]);

  if (!current) return null;

  async function pick(id: string) {
    setOpen(false);
    if (id !== activeTeamId) await Promise.resolve(onSelect(id));
  }

  return (
    <div
      ref={rootRef}
      className={`team-switcher${collapsed ? ' team-switcher--collapsed' : ''}`}
    >
      <button
        type="button"
        className="team-switcher-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <TeamAvatar teamId={current.id} name={current.name} size={collapsed ? 36 : 32} />
        {!collapsed && (
          <>
            <span className="team-switcher-name">{current.name}</span>
            <ChevronDown size={18} strokeWidth={2} className="team-switcher-chevron" data-open={open} />
          </>
        )}
      </button>
      {open && (
        <ul className="team-switcher-menu" role="listbox">
          {teams.map((t) => (
            <li key={t.id} role="option" aria-selected={t.id === activeTeamId}>
              <button type="button" className="team-switcher-option" onClick={() => void pick(t.id)}>
                <TeamAvatar teamId={t.id} name={t.name} size={28} />
                <span className="team-switcher-option-name">{t.name}</span>
                {t.id === activeTeamId && <Check size={16} strokeWidth={2} className="team-switcher-check" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
