import type { TeamPolicies, TeamSettings } from '../types';

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

export function parseTeamSettings(data: Record<string, unknown> | undefined): TeamSettings {
  if (!data) return { ...DEFAULT_TEAM_SETTINGS };
  const policies = parseTeamPolicies(data.policies);
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
  };
}

export function effectiveExpectedStart(
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
  return { hour: team.expectedStartHour, minute: team.expectedStartMinute };
}
