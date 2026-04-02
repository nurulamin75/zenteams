import type { Timestamp } from 'firebase/firestore';
import type { DayEntry } from '../types';
import { dayFirstClockIn, dayHasOpenSession, dayHasPunches } from './dayEntry';

export type AttendancePillVariant = 'present' | 'late' | 'active' | 'off' | 'holiday' | 'pto';

export function expectedStartMs(dateId: string, hour: number, minute: number): number {
  const [y, m, d] = dateId.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute, 0, 0).getTime();
}

export function isClockInLate(dateId: string, clockIn: Timestamp, hour: number, minute: number): boolean {
  return clockIn.toDate().getTime() > expectedStartMs(dateId, hour, minute);
}

export function attendanceRowPill(
  dateId: string,
  todayId: string,
  entry: DayEntry | null,
  expectedHour = 9,
  expectedMinute = 0,
  opts?: { isTeamHoliday?: boolean; isMemberPto?: boolean }
): { variant: AttendancePillVariant; label: string } {
  if (opts?.isTeamHoliday) return { variant: 'holiday', label: 'Holiday' };
  if (opts?.isMemberPto) return { variant: 'pto', label: 'PTO' };
  const firstIn = dayFirstClockIn(entry);
  if (!dayHasPunches(entry) || !firstIn) return { variant: 'off', label: '—' };
  if (dayHasOpenSession(entry)) {
    if (dateId === todayId) return { variant: 'active', label: 'Present' };
    return { variant: 'active', label: 'Open' };
  }
  if (isClockInLate(dateId, firstIn, expectedHour, expectedMinute)) {
    return { variant: 'late', label: 'Late' };
  }
  return { variant: 'present', label: 'Present' };
}
