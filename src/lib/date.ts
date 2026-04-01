export function localDateId(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function lastNDates(n: number, from = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() - i);
    out.push(localDateId(d));
  }
  return out;
}

export function formatTime(ts: { toDate: () => Date } | null | undefined): string {
  if (!ts) return '—';
  return ts.toDate().toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatShortDayLabel(dateId: string): string {
  const d = new Date(`${dateId}T12:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatLongDate(dateId: string): string {
  return new Date(`${dateId}T12:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatHourMinute(hour: number, minute: number): string {
  return new Date(2000, 0, 1, hour, minute, 0, 0).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDurationFromHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '0m';
  const totalMin = Math.max(0, Math.round(hours * 60));
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  if (hh === 0) return `${mm}m`;
  return mm ? `${hh}h ${mm}m` : `${hh}h`;
}
