import { deleteField } from 'firebase/firestore';
import type { ClockInGeo, DayBreak, DayEntry, WorkLocation, WorkSession } from '../types';
import { formatTime } from './date';

export function purgeLegacyDayEntryFields(): Record<string, unknown> {
  return {
    clockIn: deleteField(),
    clockOut: deleteField(),
    breaks: deleteField(),
    note: deleteField(),
    clockInGeo: deleteField(),
    workLocation: deleteField(),
  };
}

function normalizeBreaks(raw: unknown): DayBreak[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((b) => {
    const x = b as DayBreak;
    return {
      start: x.start,
      end: x.end === undefined ? null : x.end,
    };
  });
}

function parseGeo(raw: unknown): ClockInGeo | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Record<string, unknown>;
  const lat = g.lat;
  const lng = g.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return {
    lat,
    lng,
    accuracy: typeof g.accuracy === 'number' ? g.accuracy : undefined,
  };
}

function normalizeSession(raw: unknown): WorkSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const clockIn = o.clockIn;
  if (!clockIn || typeof (clockIn as { toDate?: () => Date }).toDate !== 'function') return null;
  const ci = clockIn as WorkSession['clockIn'];
  const clockOut = o.clockOut;
  return {
    clockIn: ci,
    clockOut:
      clockOut != null && typeof (clockOut as { toDate?: () => Date }).toDate === 'function'
        ? (clockOut as WorkSession['clockOut'])
        : null,
    breaks: normalizeBreaks(o.breaks),
    workLocation: (o.workLocation as WorkLocation | null | undefined) ?? undefined,
    note: typeof o.note === 'string' ? o.note : o.note === null ? null : undefined,
    clockInGeo: parseGeo(o.clockInGeo),
  };
}

function normalizeSessionsFromArray(raw: unknown[]): WorkSession[] {
  const out: WorkSession[] = [];
  for (const item of raw) {
    const s = normalizeSession(item);
    if (s) out.push(s);
  }
  return out;
}

export function parseDayEntry(data: Record<string, unknown> | undefined): DayEntry | null {
  if (!data || typeof data !== 'object') return null;
  const updatedAt = data.updatedAt;
  if (!updatedAt || typeof (updatedAt as { toDate?: () => Date }).toDate !== 'function') return null;

  const rawSessions = data.sessions;
  if (Array.isArray(rawSessions) && rawSessions.length > 0) {
    const sessions = normalizeSessionsFromArray(rawSessions);
    if (sessions.length === 0) return null;
    return { sessions, updatedAt: updatedAt as DayEntry['updatedAt'] };
  }

  const legacyIn = data.clockIn;
  if (legacyIn && typeof (legacyIn as { toDate?: () => Date }).toDate === 'function') {
    const clockOut = data.clockOut;
    return {
      sessions: [
        {
          clockIn: legacyIn as WorkSession['clockIn'],
          clockOut:
            clockOut != null && typeof (clockOut as { toDate?: () => Date }).toDate === 'function'
              ? (clockOut as WorkSession['clockOut'])
              : null,
          breaks: normalizeBreaks(data.breaks),
          workLocation: (data.workLocation as WorkLocation | null) ?? undefined,
          note: typeof data.note === 'string' ? data.note : data.note === null ? null : undefined,
          clockInGeo: parseGeo(data.clockInGeo),
        },
      ],
      updatedAt: updatedAt as DayEntry['updatedAt'],
    };
  }

  return null;
}

export function dayHasPunches(entry: DayEntry | null | undefined): boolean {
  return Boolean(entry && entry.sessions.length > 0);
}

export function getOpenSession(entry: DayEntry | null | undefined): WorkSession | null {
  if (!entry?.sessions.length) return null;
  for (let i = entry.sessions.length - 1; i >= 0; i--) {
    const s = entry.sessions[i]!;
    if (s.clockOut == null) return s;
  }
  return null;
}

export function getOpenSessionIndex(entry: DayEntry | null | undefined): number {
  if (!entry?.sessions.length) return -1;
  for (let i = entry.sessions.length - 1; i >= 0; i--) {
    if (entry.sessions[i]!.clockOut == null) return i;
  }
  return -1;
}

export function dayHasOpenSession(entry: DayEntry | null | undefined): boolean {
  return getOpenSession(entry) != null;
}

export function dayFirstClockIn(entry: DayEntry | null | undefined): WorkSession['clockIn'] | null {
  return entry?.sessions[0]?.clockIn ?? null;
}

export function dayLastClockOut(entry: DayEntry | null | undefined): WorkSession['clockOut'] | null {
  if (!entry?.sessions.length) return null;
  const last = entry.sessions[entry.sessions.length - 1]!;
  return last.clockOut;
}

export function dayDisplayWorkLocation(entry: DayEntry | null | undefined): WorkLocation | null {
  const open = getOpenSession(entry);
  if (open?.workLocation === 'office' || open?.workLocation === 'remote') return open.workLocation;
  const first = entry?.sessions[0];
  if (first?.workLocation === 'office' || first?.workLocation === 'remote') return first.workLocation;
  return null;
}

export function dayWorkLocationSummary(entry: DayEntry | null | undefined): string {
  if (!entry?.sessions.length) return '—';
  const set = new Set(
    entry.sessions.map((s) => s.workLocation).filter((w): w is WorkLocation => w === 'office' || w === 'remote')
  );
  if (set.size === 0) return '—';
  if (set.size === 1) {
    const v = [...set][0]!;
    return v === 'office' ? 'Office' : 'Remote';
  }
  return 'Mixed';
}

export function sessionInOutLines(entry: DayEntry | null): { clockIns: string[]; clockOuts: string[] } {
  if (!entry?.sessions.length) return { clockIns: ['—'], clockOuts: ['—'] };
  return {
    clockIns: entry.sessions.map((s) => formatTime(s.clockIn)),
    clockOuts: entry.sessions.map((s) => (s.clockOut ? formatTime(s.clockOut) : '—')),
  };
}

function sessionGrossMs(session: WorkSession, endMs: number): number {
  const start = session.clockIn.toDate().getTime();
  const end = session.clockOut ? session.clockOut.toDate().getTime() : endMs;
  return Math.max(0, end - start);
}

export function sessionWorkedHours(session: WorkSession, now: Date): number {
  const start = session.clockIn.toDate().getTime();
  const end = session.clockOut ? session.clockOut.toDate().getTime() : now.getTime();
  let ms = end - start;
  for (const b of session.breaks) {
    const bs = b.start.toDate().getTime();
    const be =
      b.end != null ? b.end.toDate().getTime() : session.clockOut ? end : now.getTime();
    const o0 = Math.max(bs, start);
    const o1 = Math.min(be, end);
    if (o1 > o0) ms -= o1 - o0;
  }
  return Math.max(0, ms) / (1000 * 60 * 60);
}

export function grossShiftMs(entry: DayEntry, now: Date): number {
  if (!entry.sessions.length) return 0;
  const endMs = now.getTime();
  return entry.sessions.reduce((sum, s) => sum + sessionGrossMs(s, endMs), 0);
}

/** Gross time for the currently open session only (hero timer). */
export function openSessionGrossMs(entry: DayEntry | null, now: Date): number {
  const open = getOpenSession(entry);
  if (!open) return 0;
  return sessionGrossMs(open, now.getTime());
}

export function entryWorkedHours(entry: DayEntry, now: Date): number {
  if (!entry.sessions.length) return 0;
  return entry.sessions.reduce((sum, s) => sum + sessionWorkedHours(s, now), 0);
}

export function entryHoursByLocation(entry: DayEntry, now: Date): { office: number; remote: number } {
  let office = 0;
  let remote = 0;
  for (const s of entry.sessions) {
    const h = sessionWorkedHours(s, now);
    if (s.workLocation === 'office') office += h;
    else if (s.workLocation === 'remote') remote += h;
  }
  return { office, remote };
}

export function breaksSummaryForSessions(sessions: WorkSession[]): string {
  const parts: string[] = [];
  sessions.forEach((session, si) => {
    if (!session.breaks.length) return;
    const prefix = sessions.length > 1 ? `S${si + 1} ` : '';
    session.breaks.forEach((b, i) => {
      const start = formatTime(b.start);
      const end = b.end != null ? formatTime(b.end) : 'open';
      parts.push(`${prefix}#${i + 1} ${start}-${end}`);
    });
  });
  return parts.join('; ');
}
