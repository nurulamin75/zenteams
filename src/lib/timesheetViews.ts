import { localDateId } from './date';
import type { TimesheetLine } from '../types';

export type TimesheetViewMode = 'table' | 'calendar' | 'byDay';

export const TIMESHEET_VIEW_STORAGE_KEY = 'zenteams-timesheet-view';

export function readStoredTimesheetView(): TimesheetViewMode {
  try {
    const v = localStorage.getItem(TIMESHEET_VIEW_STORAGE_KEY);
    if (v === 'table' || v === 'calendar' || v === 'byDay') return v;
  } catch {
    /* ignore */
  }
  return 'table';
}

export function writeStoredTimesheetView(view: TimesheetViewMode) {
  try {
    localStorage.setItem(TIMESHEET_VIEW_STORAGE_KEY, view);
  } catch {
    /* ignore */
  }
}

export function groupLinesByDateId(lines: TimesheetLine[]): Map<string, TimesheetLine[]> {
  const m = new Map<string, TimesheetLine[]>();
  for (const l of lines) {
    const arr = m.get(l.dateId) ?? [];
    arr.push(l);
    m.set(l.dateId, arr);
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  }
  return m;
}

export type CalendarCell = {
  dateId: string;
  dayLabel: number;
  inCurrentMonth: boolean;
};

export function buildCalendarMonthCells(year: number, monthIndex: number): CalendarCell[] {
  const first = new Date(year, monthIndex, 1);
  const pad = (first.getDay() + 6) % 7;
  const dim = new Date(year, monthIndex + 1, 0).getDate();
  const cells: CalendarCell[] = [];
  const prevMonthLast = new Date(year, monthIndex, 0).getDate();
  for (let i = 0; i < pad; i++) {
    const day = prevMonthLast - pad + i + 1;
    const d = new Date(year, monthIndex - 1, day);
    cells.push({ dateId: localDateId(d), dayLabel: day, inCurrentMonth: false });
  }
  for (let d = 1; d <= dim; d++) {
    cells.push({
      dateId: localDateId(new Date(year, monthIndex, d)),
      dayLabel: d,
      inCurrentMonth: true,
    });
  }
  let trail = 1;
  while (cells.length % 7 !== 0) {
    const d = new Date(year, monthIndex + 1, trail);
    cells.push({ dateId: localDateId(d), dayLabel: trail, inCurrentMonth: false });
    trail += 1;
  }
  return cells;
}

export function formatCalendarMonthTitle(year: number, monthIndex: number): string {
  return new Date(year, monthIndex, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

export function weekdayShortLabels(): string[] {
  const refMonday = new Date(2023, 5, 5);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(refMonday);
    d.setDate(refMonday.getDate() + i);
    out.push(d.toLocaleDateString(undefined, { weekday: 'short' }));
  }
  return out;
}
