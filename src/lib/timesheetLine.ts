import type { Timestamp } from 'firebase/firestore';
import type { TimesheetLine } from '../types';

const MAX_LEN = 200;
const MAX_TAGS = 500;

export function parseTimesheetLine(id: string, data: Record<string, unknown>): TimesheetLine | null {
  const userId = data.userId;
  const dateId = data.dateId;
  const project = data.project;
  const client = data.client;
  const task = data.task;
  const hours = data.hours;
  const createdAt = data.createdAt;
  const updatedAt = data.updatedAt;
  if (
    typeof userId !== 'string' ||
    typeof dateId !== 'string' ||
    typeof project !== 'string' ||
    typeof client !== 'string' ||
    typeof task !== 'string' ||
    typeof hours !== 'number' ||
    !createdAt ||
    typeof (createdAt as Timestamp).toDate !== 'function' ||
    !updatedAt ||
    typeof (updatedAt as Timestamp).toDate !== 'function'
  ) {
    return null;
  }
  const notes = data.notes;
  const activity = data.activity;
  const startTimeLocal = data.startTimeLocal;
  const endTimeLocal = data.endTimeLocal;
  const tags = data.tags;
  const projectId = data.projectId;
  return {
    id,
    userId,
    dateId,
    project,
    client,
    task,
    hours,
    activity: typeof activity === 'string' ? activity : '',
    startTimeLocal:
      typeof startTimeLocal === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(startTimeLocal)
        ? normalizeHhMm(startTimeLocal)
        : null,
    endTimeLocal:
      typeof endTimeLocal === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(endTimeLocal)
        ? normalizeHhMm(endTimeLocal)
        : null,
    tags: typeof tags === 'string' && tags.length > 0 ? tags.slice(0, MAX_TAGS) : null,
    notes: typeof notes === 'string' && notes.length > 0 ? notes : null,
    projectId:
      typeof projectId === 'string' && projectId.length > 0 && projectId.length <= 120 ? projectId : null,
    createdAt: createdAt as Timestamp,
    updatedAt: updatedAt as Timestamp,
  };
}

function normalizeHhMm(s: string): string {
  const [a, b] = s.split(':');
  const h = String(Math.min(23, Math.max(0, Number.parseInt(a ?? '0', 10)))).padStart(2, '0');
  const m = String(Math.min(59, Math.max(0, Number.parseInt(b ?? '0', 10)))).padStart(2, '0');
  return `${h}:${m}`;
}

export function clampHours(raw: string): number | null {
  const n = Number.parseFloat(raw.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > 24) return null;
  return Math.round(n * 100) / 100;
}

export function truncateField(s: string): string {
  return s.trim().slice(0, MAX_LEN);
}

export function truncateTags(s: string): string {
  return s.trim().slice(0, MAX_TAGS);
}

/** Hours between same-day HH:mm strings; null if invalid. */
export function hoursFromStartEndLocal(start: string, end: string): number | null {
  const a = parseHhMm(start);
  const b = parseHhMm(end);
  if (a == null || b == null) return null;
  let diffMin = b.totalMin - a.totalMin;
  if (diffMin <= 0) return null;
  return Math.round((diffMin / 60) * 100) / 100;
}

function parseHhMm(s: string): { totalMin: number } | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s.trim());
  if (!m) return null;
  const h = Number.parseInt(m[1]!, 10);
  const min = Number.parseInt(m[2]!, 10);
  return { totalMin: h * 60 + min };
}

export function formatTime12h(hhmm: string | null): string {
  if (!hhmm) return '—';
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return hhmm;
  let h = Number.parseInt(m[1]!, 10);
  const min = m[2]!;
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${ap}`;
}

/** Display like 1:30 for fractional hours (reference style). */
export function formatHoursAsHMM(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '0:00';
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function escapeCsvCell(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
