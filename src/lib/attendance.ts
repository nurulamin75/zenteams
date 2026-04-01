import type { Timestamp } from 'firebase/firestore';
import type { DayEntry } from '../types';

export const DEFAULT_SHIFT_START = { hour: 9, minute: 0 };

export function expectedStartMs(dateId: string): number {
  const [y, m, d] = dateId.split('-').map(Number);
  return new Date(y, m - 1, d, DEFAULT_SHIFT_START.hour, DEFAULT_SHIFT_START.minute, 0, 0).getTime();
}

export function isClockInLate(dateId: string, clockIn: Timestamp): boolean {
  return clockIn.toDate().getTime() > expectedStartMs(dateId);
}

export type AttendancePillVariant = 'present' | 'late' | 'active' | 'off';

export function attendanceRowPill(
  dateId: string,
  todayId: string,
  entry: DayEntry | null
): { variant: AttendancePillVariant; label: string } {
  if (!entry?.clockIn) return { variant: 'off', label: '—' };
  if (!entry.clockOut) {
    if (dateId === todayId) return { variant: 'active', label: 'Present' };
    return { variant: 'active', label: 'Open' };
  }
  if (isClockInLate(dateId, entry.clockIn)) return { variant: 'late', label: 'Late' };
  return { variant: 'present', label: 'Present' };
}
