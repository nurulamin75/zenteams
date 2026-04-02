import type { Timestamp } from 'firebase/firestore';

export type WorkLocation = 'office' | 'remote';

export type MemberRole = 'admin' | 'manager' | 'member' | 'auditor';

export interface TeamPolicies {
  maxBreakMinutes?: number | null;
  minBreakMinutesBetween?: number | null;
  autoClockOutHours?: number | null;
}

/** Per weekday expected start (0 = Sunday … 6 = Saturday). Missing key → team default. */
export type WeeklyExpectedStartMap = Partial<
  Record<'0' | '1' | '2' | '3' | '4' | '5' | '6', { hour: number; minute: number }>
>;

export interface TeamSettings {
  expectedStartHour: number;
  expectedStartMinute: number;
  policies: TeamPolicies;
  weeklySchedule?: WeeklyExpectedStartMap | null;
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

/** One clock-in → clock-out segment (user may have several per day). */
export interface WorkSession {
  clockIn: Timestamp;
  clockOut: Timestamp | null;
  breaks: DayBreak[];
  workLocation?: WorkLocation | null;
  note?: string | null;
  clockInGeo?: ClockInGeo | null;
}

export interface DayEntry {
  sessions: WorkSession[];
  updatedAt: Timestamp;
}

export interface MemberProfile {
  role: MemberRole;
  displayName: string;
  email: string;
  joinedAt: Timestamp;
  inviteCode?: string;
  expectedStartHour?: number | null;
  expectedStartMinute?: number | null;
  /** IANA or label, e.g. America/New_York */
  timezone?: string | null;
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
  /** Browser notifications when permitted */
  notifyLongShiftHours?: number | null;
  notifyBeforeExpectedStart?: boolean;
}

export interface UserTeam {
  id: string;
  name: string;
}

export interface TimesheetLine {
  id: string;
  userId: string;
  dateId: string;
  project: string;
  client: string;
  task: string;
  activity: string;
  hours: number;
  startTimeLocal: string | null;
  endTimeLocal: string | null;
  tags: string | null;
  notes: string | null;
  projectId?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface TeamProject {
  id: string;
  name: string;
  client: string;
  archived: boolean;
  createdAt: Timestamp;
}

export interface PtoApprovalRequest {
  kind: 'pto';
  status: ApprovalStatus;
  requesterUid: string;
  dateId: string;
  label: string | null;
  note: string | null;
  createdAt: Timestamp;
  reviewedByUid?: string | null;
  reviewedAt?: Timestamp | null;
}
