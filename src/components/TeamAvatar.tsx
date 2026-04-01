import { teamAvatarHue, teamInitials } from '../lib/teamVisual';

export function TeamAvatar({
  teamId,
  name,
  size = 32,
  className = '',
}: {
  teamId: string;
  name: string;
  size?: number;
  className?: string;
}) {
  const hue = teamAvatarHue(teamId);
  const initials = teamInitials(name || 'Team');
  return (
    <span
      className={`team-avatar ${className}`.trim()}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, size * 0.36),
        background: `hsl(${hue} 52% 42%)`,
      }}
      aria-hidden
    >
      {initials}
    </span>
  );
}
