import type { TeamPolicies, TeamSettings, WeeklyExpectedStartMap } from '../types';

export const DEFAULT_TEAM_SETTINGS: TeamSettings = {
  expectedStartHour: 9,
  expectedStartMinute: 0,
  policies: {},
};

export function parseTeamPolicies(raw: unknown): TeamPolicies {
  if (!raw || typeof raw !== 'object') return {};
  const p = raw as Record<string, unknown>;
  return {
    maxBreakMinutes: typeof p.maxBreakMinutes === 'number' ? p.maxBreakMinutes : null,
    minBreakMinutesBetween: typeof p.minBreakMinutesBetween === 'number' ? p.minBreakMinutesBetween : null,
    autoClockOutHours: typeof p.autoClockOutHours === 'number' ? p.autoClockOutHours : null,
  };
}

function parseWeeklySchedule(raw: unknown): WeeklyExpectedStartMap | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: WeeklyExpectedStartMap = {};
  const keys = ['0', '1', '2', '3', '4', '5', '6'] as const;
  for (const k of keys) {
    const v = (raw as Record<string, unknown>)[k];
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const h = o.hour;
    const m = o.minute;
    if (typeof h === 'number' && h >= 0 && h <= 23 && typeof m === 'number' && m >= 0 && m <= 59) {
      out[k] = { hour: h, minute: m };
    }
  }
  return Object.keys(out).length ? out : null;
}

export function parseTeamSettings(data: Record<string, unknown> | undefined): TeamSettings {
  if (!data) return { ...DEFAULT_TEAM_SETTINGS };
  const policies = parseTeamPolicies(data.policies);
  const weeklySchedule = parseWeeklySchedule(data.weeklySchedule);
  return {
    expectedStartHour:
      typeof data.expectedStartHour === 'number' && data.expectedStartHour >= 0 && data.expectedStartHour <= 23
        ? data.expectedStartHour
        : DEFAULT_TEAM_SETTINGS.expectedStartHour,
    expectedStartMinute:
      typeof data.expectedStartMinute === 'number' &&
      data.expectedStartMinute >= 0 &&
      data.expectedStartMinute <= 59
        ? data.expectedStartMinute
        : DEFAULT_TEAM_SETTINGS.expectedStartMinute,
    policies,
    weeklySchedule: weeklySchedule ?? undefined,
  };
}

export function effectiveExpectedStartForDate(
  dateId: string,
  team: TeamSettings,
  memberOverride: { hour: number; minute: number } | null
): { hour: number; minute: number } {
  if (
    memberOverride &&
    typeof memberOverride.hour === 'number' &&
    memberOverride.hour >= 0 &&
    memberOverride.hour <= 23 &&
    typeof memberOverride.minute === 'number' &&
    memberOverride.minute >= 0 &&
    memberOverride.minute <= 59
  ) {
    return { hour: memberOverride.hour, minute: memberOverride.minute };
  }
  const ws = team.weeklySchedule;
  if (ws && Object.keys(ws).length > 0) {
    const d = new Date(`${dateId}T12:00:00`);
    const key = String(d.getDay()) as keyof WeeklyExpectedStartMap;
    const day = ws[key];
    if (day && typeof day.hour === 'number' && typeof day.minute === 'number') {
      return { hour: day.hour, minute: day.minute };
    }
  }
  return { hour: team.expectedStartHour, minute: team.expectedStartMinute };
}

