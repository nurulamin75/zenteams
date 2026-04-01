import type { Timestamp } from 'firebase/firestore';

export type WorkLocation = 'office' | 'remote';

export type MemberRole = 'admin' | 'member';

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
}

export interface MemberProfile {
  role: MemberRole;
  displayName: string;
  email: string;
  joinedAt: Timestamp;
  inviteCode?: string;
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
