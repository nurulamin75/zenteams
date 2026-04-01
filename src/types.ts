import type { Timestamp } from 'firebase/firestore';

export type WorkLocation = 'office' | 'remote';

export type MemberRole = 'admin' | 'manager' | 'member';

export interface TeamPolicies {
  maxBreakMinutes?: number | null;
  minBreakMinutesBetween?: number | null;
  autoClockOutHours?: number | null;
}

export interface TeamSettings {
  expectedStartHour: number;
  expectedStartMinute: number;
  policies: TeamPolicies;
}

export interface ClockInGeo {
  lat: number;
  lng: number;
  accuracy?: number;
}

export interface DayBreak {
  start: Timestamp;
  end: Timestamp | null;
}

export interface DayEntry {
  clockIn: Timestamp | null;
  clockOut: Timestamp | null;
  breaks: DayBreak[];
  workLocation: WorkLocation | null;
  updatedAt: Timestamp;
  note?: string | null;
  clockInGeo?: ClockInGeo | null;
}

export interface MemberProfile {
  role: MemberRole;
  displayName: string;
  email: string;
  joinedAt: Timestamp;
  inviteCode?: string;
  expectedStartHour?: number | null;
  expectedStartMinute?: number | null;
}

export type TimeOffKind = 'holiday' | 'pto';

export interface TimeOffRecord {
  dateId: string;
  kind: TimeOffKind;
  userId?: string | null;
  label?: string | null;
  createdAt: Timestamp;
}

export type ThemePreference = 'light' | 'dark' | 'system';

export interface UserPreferences {
  theme?: ThemePreference;
  compactUI?: boolean;
}

export interface UserTeam {
  id: string;
  name: string;
}
